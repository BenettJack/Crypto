"use client";

import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { useWallet } from "../../hooks/useWallet";

type DeployedInfo = { address: `0x${string}`; abi: any };
type ReferendumInfo = {
  id: number;
  title: string;
  description: string;
  options: string[];
  deadline: number;
  finalized: boolean;
  publicResult: boolean;
  hasVoted: boolean;
};

async function fetchDeployment(): Promise<DeployedInfo | null> {
  try {
    const tryPaths = [
      "deployments/sepolia/CryptoReferendum.json",
      "deployments/localhost/CryptoReferendum.json",
    ];
    for (const p of tryPaths) {
      const res = await fetch(p).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        return {
          address: data.address as `0x${string}`,
          abi: data.abi,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default function VotePage() {
  const { account, chainId, isConnected, fhevm, provider } = useWallet();
  const [deployment, setDeployment] = useState<DeployedInfo | null>(null);
  const [referendums, setReferendums] = useState<ReferendumInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});

  useEffect(() => {
    (async () => {
      const dep = await fetchDeployment();
      setDeployment(dep);
    })();
  }, []);

  const contractRW = useMemo(() => {
    if (!deployment || !provider) return undefined;
    return new Contract(deployment.address, deployment.abi, provider);
  }, [deployment, provider]);

  useEffect(() => {
    if (deployment && account && provider && contractRW) {
      loadReferendums();
    }
  }, [deployment, account, provider, contractRW]);

  const loadReferendums = async () => {
    if (!deployment || !account || !contractRW || !provider) return;
    setIsLoading(true);
    setMessage("加载公投列表...");
    
    try {
      // 使用只读provider获取公投数量
      const readOnlyProvider = new JsonRpcProvider("http://127.0.0.1:8545");
      const readOnlyContract = new Contract(deployment.address, deployment.abi, readOnlyProvider);
      const count = await readOnlyContract.referendumCount();
      const refCount = Number(count);
      
      if (refCount === 0) {
        setReferendums([]);
        setMessage("暂无公投");
        return;
      }
      
      // 使用签名provider获取公投详情
      const signer = await provider.getSigner();
      const writableContract = contractRW.connect(signer) as any;
      
      const refs: ReferendumInfo[] = [];
      for (let i = 0; i < refCount; i++) {
        try {
          const result = await (writableContract as any).getReferendumMeta(BigInt(i));
          const [title, description, options, deadline, finalized, publicResult] = result;
        
          // 检查用户是否已投票
          let hasVoted = false;
          try {
            const votedKey = `voted_${account}_${i}`;
            hasVoted = localStorage.getItem(votedKey) === 'true';
          } catch {
            hasVoted = false;
          }

          refs.push({
            id: i,
            title,
            description,
            options,
            deadline: Number(deadline),
            finalized,
            publicResult,
            hasVoted,
          });
        } catch (error: any) {
          console.error(`Error loading referendum ${i}:`, error);
          continue;
        }
      }
      
      setReferendums(refs);
      setMessage(`加载了 ${refCount} 个公投`);
    } catch (error: any) {
      setMessage(`加载失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const vote = async (refId: number, optionIndex: number) => {
    if (!contractRW || !fhevm || !deployment || !account) return;
    setIsLoading(true);
    setMessage(`正在为公投 ${refId} 投票...`);

    try {
      const signer = await provider!.getSigner();
      const writable = contractRW.connect(signer) as any;

      const input = fhevm.createEncryptedInput(deployment.address, await signer.getAddress());
      input.add32(BigInt(optionIndex));
      const enc = await input.encrypt();
      const tx = await (writable as any).castVote(BigInt(refId), enc.handles[0], enc.inputProof, BigInt(optionIndex));
      setMessage("等待交易确认...");
      await tx.wait();
      setMessage(`公投 ${refId} 投票成功！`);

      // 在本地存储中记录已投票状态
      const votedKey = `voted_${account}_${refId}`;
      localStorage.setItem(votedKey, 'true');

      // 更新状态标记为已投票
      setReferendums(prev => prev.map(ref =>
        ref.id === refId ? { ...ref, hasVoted: true } : ref
      ));
    } catch (error: any) {
      if (error.message.includes('already voted')) {
        setMessage(`您已经为公投 ${refId} 投过票了`);
      } else {
        setMessage(`投票失败: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOptionChange = (refId: number, optionIndex: number) => {
    setSelectedOptions(prev => ({
      ...prev,
      [refId]: optionIndex
    }));
  };

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">投票中心</h1>
              <p className="text-gray-600 mt-1">参与匿名公投，行使你的权利</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Status Message */}
        {message && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="flex items-center">
              {isLoading && (
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-3"></div>
              )}
              <p className="text-blue-800">{message}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">公投列表</h2>
            <p className="text-gray-600">共 {referendums.length} 个公投</p>
          </div>
          <button
            onClick={loadReferendums}
            disabled={isLoading}
            className="btn-secondary"
          >
            刷新列表
          </button>
        </div>

        {/* Referendum List */}
        {!isConnected ? (
          <div className="card-gradient text-center py-12">
            <h3 className="text-xl font-medium text-gray-800 mb-4">请连接钱包</h3>
            <p className="text-gray-600">连接 MetaMask 以查看和参与公投</p>
          </div>
        ) : referendums.length === 0 && !isLoading ? (
          <div className="card-gradient text-center py-12">
            <h3 className="text-lg font-medium text-gray-800 mb-2">暂无公投</h3>
            <p className="text-gray-600">目前还没有可参与的公投</p>
          </div>
        ) : (
          referendums.map((referendum) => {
            const isExpired = now > referendum.deadline;
            const canVote = isConnected && !isExpired && !referendum.hasVoted && fhevm && !referendum.finalized;
            const selectedOption = selectedOptions[referendum.id] ?? 0;

            return (
              <div key={referendum.id} className="card-gradient mb-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-800 mb-1">
                      {referendum.title} (ID: {referendum.id})
                    </h3>
                    <p className="text-gray-600 text-sm mb-2">{referendum.description}</p>
                    <div className="flex items-center text-xs text-gray-500">
                      <span className="mr-3">截止时间: {new Date(referendum.deadline * 1000).toLocaleString()}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${referendum.finalized ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                        {referendum.finalized ? "已结束" : "进行中"}
                      </span>
                    </div>
                  </div>
                  {referendum.hasVoted && (
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">
                      已投票
                    </span>
                  )}
                </div>

                {/* Voting Options */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">投票选项:</h4>
                  <div className="grid gap-3">
                    {referendum.options.map((option, index) => (
                      <label
                        key={index}
                        className={`flex items-center p-4 rounded-lg border-2 transition-all ${
                          referendum.hasVoted
                            ? "border-gray-200 bg-gray-50 cursor-not-allowed"
                            : selectedOption === index
                              ? "border-blue-500 bg-blue-50 cursor-pointer"
                              : "border-gray-200 hover:border-gray-300 cursor-pointer"
                        } ${!canVote && !referendum.hasVoted ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <input
                          type="radio"
                          name={`referendum-${referendum.id}`}
                          value={index}
                          checked={selectedOption === index}
                          onChange={() => handleOptionChange(referendum.id, index)}
                          disabled={!canVote || referendum.hasVoted}
                          className="mr-3 text-blue-600"
                        />
                        <div className="flex-1">
                          <div className={`font-medium ${referendum.hasVoted ? "text-gray-500" : "text-gray-800"}`}>
                            选项 {index}: {option}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Vote Button */}
                <div className="flex justify-between items-center">
                  <div className="text-sm text-gray-500">
                    {referendum.hasVoted ? "您已参与此次投票" :
                     referendum.finalized ? "投票已结束" :
                     isExpired ? "投票已截止" :
                     !isConnected ? "请先连接钱包" :
                     !fhevm ? "正在初始化加密..." :
                     "选择选项后点击投票"}
                  </div>
                  <button
                    onClick={() => vote(referendum.id, selectedOption)}
                    disabled={!canVote || isLoading}
                    className={`${referendum.hasVoted ? "btn-secondary" : "btn-primary"} ${!canVote ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {referendum.hasVoted ? "已投票" : isLoading ? "投票中..." : "投票"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}