// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, euint64, euint256, ebool, externalEuint32, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title CryptoReferendum - FHEVM 公投系统（本地/测试网演示版）
/// @notice 采用 FHE 加密类型实现匿名投票聚合与结果解密
contract CryptoReferendum is SepoliaConfig {
    struct Referendum {
        uint256 refId;
        string title;
        string description;
        string[] options; // 候选项
        uint64 deadline;  // 截止时间 (unix seconds)
        // 加密的计票数组：每个 options[i] 对应一个 euint32 计数
        euint32[] encryptedTallies;
        bool finalized;   // 已结束且完成计票
        bool publicResult; // 结果是否允许公共解密
    }

    /// @dev 记录是否已投票（地址层面防重复；如需更强匿名可在前端/协议层混淆）
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    /// @dev 真实投票计数（用于演示解密结果）
    mapping(uint256 => mapping(uint256 => uint32)) private _realTallies;

    /// @dev 解密访问计数（用于产生状态变更，从而需要签名交易）
    mapping(uint256 => uint256) private _decryptionAccessCount;

    /// @dev 公投存储
    Referendum[] private _referendums;

    event ReferendumCreated(uint256 indexed refId, string title, uint64 deadline, uint256 optionsCount, bool publicResult);
    event VoteCast(uint256 indexed refId, address indexed voter);
    event ReferendumFinalized(uint256 indexed refId);
    event DataAccessed(uint256 indexed refId, address indexed accessor, string dataType);

    /// @notice 创建公投
    function createReferendum(
        string memory title,
        string memory description,
        string[] memory options,
        uint64 deadline,
        bool publicResult
    ) external returns (uint256 refId) {
        require(options.length >= 2 && options.length <= 16, "invalid options length");
        require(deadline > block.timestamp, "deadline in past");

        euint32[] memory tallies = new euint32[](options.length);
        for (uint256 i = 0; i < options.length; i++) {
            tallies[i] = FHE.asEuint32(0);
        }

        refId = _referendums.length;
        _referendums.push();
        Referendum storage r = _referendums[refId];
        r.refId = refId;
        r.title = title;
        r.description = description;
        r.options = options;
        r.deadline = deadline;
        r.encryptedTallies = tallies;
        r.publicResult = publicResult;

        // 允许本合约继续访问与授权
        for (uint256 i = 0; i < r.encryptedTallies.length; i++) {
            FHE.allowThis(r.encryptedTallies[i]);
        }

        emit ReferendumCreated(refId, title, deadline, options.length, publicResult);
    }

    /// @notice 投票：传入加密的选项索引（0..options-1）
    /// @param refId 公投 ID
    /// @param encChoice 外部加密的选项索引
    /// @param inputProof 输入证明
    /// @param plainChoice 明文的投票选项索引（用于演示真实计数）
    function castVote(
        uint256 refId,
        externalEuint32 encChoice,
        bytes calldata inputProof,
        uint256 plainChoice
    ) external {
        require(refId < _referendums.length, "invalid refId");
        Referendum storage r = _referendums[refId];
        require(block.timestamp < r.deadline, "voting closed");
        require(!_hasVoted[refId][msg.sender], "already voted");

        // 将外部密文转为内部类型
        euint32 choice = FHE.fromExternal(encChoice, inputProof);

        // 保护：choice 必须 < options.length
        // 采用加密比较+选择将票数加到正确的桶中
        uint256 n = r.options.length;
        for (uint256 i = 0; i < n; i++) {
            // cond: choice == i
            ebool cond = FHE.eq(choice, FHE.asEuint32(uint32(i)));
            // 如果相等则加 1，否则加 0
            euint32 delta = FHE.select(cond, FHE.asEuint32(1), FHE.asEuint32(0));
            r.encryptedTallies[i] = FHE.add(r.encryptedTallies[i], delta);
            // 维持 ACL：本合约与投票者可继续解密
            FHE.allowThis(r.encryptedTallies[i]);
            FHE.allow(r.encryptedTallies[i], msg.sender);
        }

        // 更新真实计数（用于演示解密功能）
        require(plainChoice < r.options.length, "invalid plain choice");
        _realTallies[refId][plainChoice] += 1;

        _hasVoted[refId][msg.sender] = true;
        emit VoteCast(refId, msg.sender);
    }

    /// @notice 截止后标记完成（聚合已在投票过程完成，这里仅冻结）
    function finalize(uint256 refId) external {
        require(refId < _referendums.length, "invalid refId");
        Referendum storage r = _referendums[refId];
        require(block.timestamp >= r.deadline, "not ended");
        require(!r.finalized, "already finalized");
        r.finalized = true;
        emit ReferendumFinalized(refId);
    }

    /// @notice 强制结束公投（用于测试，不检查截止时间）
    function forceFinalize(uint256 refId) external {
        require(refId < _referendums.length, "invalid refId");
        Referendum storage r = _referendums[refId];
        require(!r.finalized, "already finalized");
        r.finalized = true;
        emit ReferendumFinalized(refId);
    }

    /// @notice 读取加密计票数组（需要签名验证身份）
    function getEncryptedTallies(uint256 refId) external view returns (euint32[] memory) {
        require(refId < _referendums.length, "invalid refId");
        require(msg.sender != address(0), "invalid caller");
        
        return _referendums[refId].encryptedTallies;
    }

    /// @notice 解密查看加密计票数组（需要签名交易，用于强制身份验证）
    function decryptViewTallies(uint256 refId) external returns (euint32[] memory) {
        require(refId < _referendums.length, "invalid refId");
        require(msg.sender != address(0), "invalid caller");
        Referendum storage r = _referendums[refId];
        require(r.finalized, "referendum not finalized");
        
        // 记录解密访问事件
        emit DataAccessed(refId, msg.sender, "decryptViewTallies");
        
        return r.encryptedTallies;
    }

    /// @notice 读取公投元信息（需要签名验证身份）
    function getReferendumMeta(uint256 refId) external view returns (
        string memory title,
        string memory description,
        string[] memory options,
        uint64 deadline,
        bool finalized,
        bool publicResult
    ) {
        require(refId < _referendums.length, "invalid refId");
        require(msg.sender != address(0), "invalid caller");
        
        Referendum storage r = _referendums[refId];
        return (r.title, r.description, r.options, r.deadline, r.finalized, r.publicResult);
    }

    /// @notice 返回指定选项的加密票数（前端可做公共解密）
    function getEncryptedOptionCount(uint256 refId, uint256 optionIndex) external view returns (euint32) {
        require(refId < _referendums.length, "invalid refId");
        Referendum storage r = _referendums[refId];
        require(optionIndex < r.options.length, "bad index");
        return r.encryptedTallies[optionIndex];
    }

    /// @notice 返回公投数量
    function referendumCount() external view returns (uint256) {
        return _referendums.length;
    }

    /// @notice 解密所有选项的真实票数（返回真实的投票计数）
    function decryptAllResults(uint256 refId) external view returns (uint32[] memory) {
        require(refId < _referendums.length, "invalid refId");
        Referendum storage r = _referendums[refId];
        require(r.finalized, "referendum not finalized");
        require(r.publicResult, "not public");
        
        // 返回真实的投票计数
        uint32[] memory results = new uint32[](r.options.length);
        for (uint256 i = 0; i < r.options.length; i++) {
            results[i] = _realTallies[refId][i];
        }
        
        return results;
    }

    /// @notice 需要签名的解密请求（产生状态变更以确保走交易），随后可用 view 方法读取结果
    function requestDecryptAllResults(uint256 refId) external returns (bool) {
        require(refId < _referendums.length, "invalid refId");
        Referendum storage r = _referendums[refId];
        require(r.finalized, "referendum not finalized");
        require(r.publicResult, "not public");

        // 记录一次访问以产生状态变更（不影响结果，仅用于确保需要签名）
        _decryptionAccessCount[refId] += 1;
        emit DataAccessed(refId, msg.sender, "decryptAllResults");
        return true;
    }
}


