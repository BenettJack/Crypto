"use client";

import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { Bar } from "react-chartjs-2";
import Link from "next/link";
import { useWallet } from "../hooks/useWallet";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title as ChartTitle,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTitle, Tooltip, Legend);

type DeployedInfo = { address: `0x${string}`; abi: any };

async function fetchDeployment(): Promise<DeployedInfo | null> {
  try {
    // 优先使用 sepolia，其次回退到 localhost
    const tryPaths = [
      "deployments/sepolia/CryptoReferendum.json",
      "deployments/localhost/CryptoReferendum.json",
    ];
    for (const p of tryPaths) {
      const res = await fetch(p).catch(() => null);
      if (res && res.ok) {
        const j = await res.json();
        return { address: j.address, abi: j.abi };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const { account, chainId, isConnected, fhevm, provider } = useWallet();
  const [deployment, setDeployment] = useState<DeployedInfo | null>(null);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [opts, setOpts] = useState<string>("赞成,反对");
  const [deadlineSec, setDeadlineSec] = useState<number>(() => Math.floor(Date.now() / 1000) + 3600);
  const [refCount, setRefCount] = useState<number>(0);

  const [selectedRef, setSelectedRef] = useState<number>(0);
  const [meta, setMeta] = useState<{ 
    title: string; 
    description: string; 
    options: string[]; 
    deadline: number; 
    finalized: boolean; 
    publicResult: boolean;
    encryptedTallies?: any[];
  } | null>(null);
  const [publicCounts, setPublicCounts] = useState<number[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    (async () => {
      const dep = await fetchDeployment();
      setDeployment(dep);
    })();
  }, []);

  useEffect(() => {
    if (deployment) {
      refreshCount();
    }
  }, [deployment]);

  const contractRW = useMemo(() => {
    if (!deployment || !provider) return undefined;
    return new Contract(deployment.address, deployment.abi, provider);
  }, [deployment, provider]);

  const createReferendum = async () => {
    if (!contractRW || !deployment) return;
    setIsLoading(true);
    setMessage("创建公投中...");
    
    try {
      const signer = await provider!.getSigner();
      const writable = contractRW.connect(signer) as any;
      const options = opts.split(",").map((s) => s.trim()).filter(Boolean);
      const tx = await (writable as any).createReferendum(title, desc, options, BigInt(deadlineSec), true);
      setMessage("等待交易确认...");
      await tx.wait();
      setMessage("公投创建成功！");
      
      // 清除所有旧的投票状态，因为这是新的公投
      if (account) {
        // 清除localStorage中的投票记录
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(`voted_${account}_`) || key.startsWith(`voted_option_${account}_`)) {
            localStorage.removeItem(key);
          }
        });
        console.log('已清除旧的投票状态');
      }
      
      await refreshCount();
      setTitle("");
      setDesc("");
      setOpts("赞成,反对");
    } catch (error: any) {
      setMessage(`创建失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshCount = async () => {
    if (!deployment) return;
    try {
      // 使用只读provider而不是依赖钱包连接
      const readOnlyProvider = new BrowserProvider((window as any).ethereum || new JsonRpcProvider("http://127.0.0.1:8545"));
      const readOnlyContract = new Contract(deployment.address, deployment.abi, readOnlyProvider);
      const c = await readOnlyContract.referendumCount();
      setRefCount(Number(c));
    } catch (error: any) {
      setMessage(`刷新失败: ${error.message}`);
    }
  };


  const loadMeta = async () => {
    if (!contractRW || !deployment || !isConnected) {
      setMessage("请先连接钱包");
      return;
    }
    
    if (selectedRef >= refCount) {
      setMessage(`公投 ${selectedRef} 不存在，当前总数: ${refCount}`);
      return;
    }
    
    setIsLoading(true);
    setMessage("正在获取公投信息，请签名确认...");
    
    try {
      const signer = await provider!.getSigner();
      const writable = contractRW.connect(signer) as any;
      
      // 调用合约获取公投元信息（需要签名）
      const [t, d, ops, deadline, finalized, pub] = await (writable as any).getReferendumMeta(BigInt(selectedRef));
      
      setMessage("正在获取加密计票数据...");
      // 获取加密的计票信息
      const encryptedTallies = await (writable as any).getEncryptedTallies(BigInt(selectedRef));
      console.log('getEncryptedTallies result:', encryptedTallies);
      
      setMeta({ 
        title: t, 
        description: d, 
        options: ops, 
        deadline: Number(deadline), 
        finalized, 
        publicResult: pub,
        encryptedTallies: encryptedTallies
      });
      setMessage(`公投 ${selectedRef} 加密信息加载成功！`);
    } catch (error: any) {
      console.error("loadMeta error:", error);
      if (error.message.includes("invalid refId")) {
        setMessage(`公投 ${selectedRef} 不存在，请先创建公投或选择有效的公投ID`);
      } else {
        setMessage(`加载失败: ${error.message}`);
      }
      setMeta(null);
    } finally {
      setIsLoading(false);
    }
  };

  const finalizeReferendum = async () => {
    console.log('finalizeReferendum called', { contractRW: !!contractRW, deployment: !!deployment });
    if (!contractRW || !deployment) {
      console.log('Missing dependencies, returning early');
      return;
    }
    setIsLoading(true);
    setMessage("结束公投中...");
    
    // 检查网络连接
    try {
      const network = await provider!.getNetwork();
      console.log('当前网络:', { chainId: network.chainId, name: network.name });
      
      if (Number(network.chainId) !== 31337) {
        setMessage(`网络错误: 当前网络ID ${network.chainId}，需要 31337 (Hardhat)`);
        setIsLoading(false);
        return;
      }
    } catch (error) {
      console.error('网络检查失败:', error);
      setMessage('网络连接失败，请检查 MetaMask 连接');
      setIsLoading(false);
      return;
    }
    
    try {
      console.log('准备调用合约...');
      const signer = await provider!.getSigner();
      console.log('获取到签名者:', await signer.getAddress());
      
      const writable = contractRW.connect(signer) as any;
      console.log('准备调用 finalize 方法...');
      
      const tx = await (writable as any).forceFinalize(BigInt(selectedRef));
      console.log('交易已发送:', tx.hash);
      setMessage("等待交易确认...");
      
      await tx.wait();
      console.log('交易已确认');
      setMessage(`公投 ${selectedRef} 已结束！`);
      // 刷新公投信息
      await loadMeta();
    } catch (error: any) {
      console.error('结束公投失败:', error);
      setMessage(`结束公投失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };


  const decryptRealResults = async () => {
    console.log('decryptRealResults called', { deployment: !!deployment, contractRW: !!contractRW, provider: !!provider });
    if (!deployment || !contractRW || !provider) {
      console.log('Missing dependencies, returning early');
      return;
    }
    setIsLoading(true);
    setMessage("解密真实投票结果中...");
    
    try {
      const signer = await provider.getSigner();
      const writableContract = contractRW.connect(signer) as any;
      
      // 获取公投元信息
      const [t, d, ops, deadline, finalized, pub] = await (writableContract as any).getReferendumMeta(BigInt(selectedRef));
      const m: { title: string; description: string; options: string[]; deadline: number; finalized: boolean; publicResult: boolean } = {
        title: t as string,
        description: d as string,
        options: ops as string[],
        deadline: Number(deadline),
        finalized: finalized as boolean,
        publicResult: pub as boolean,
      };
      
      console.log('公投状态检查:', { finalized: m.finalized, publicResult: m.publicResult });
      
      if (!m.publicResult) {
        console.log('公投未开放公开解密，返回');
        setMessage("本公投未开放公开解密");
        return;
      }
      
      if (!m.finalized) {
        console.log('公投进行中，无法解密真实结果，返回');
        setMessage("公投进行中，无法解密真实结果。请先结束公投。");
        return;
      }
      
      console.log('开始解密真实投票结果...');
      
      // 直接调用合约获取真实投票计数（现在是view函数，不需要签名）
      const readOnlyProvider = new JsonRpcProvider("http://127.0.0.1:8545");
      const readOnlyContract = new Contract(deployment.address, deployment.abi, readOnlyProvider);
      
      const realResults = await readOnlyContract.decryptAllResults(BigInt(selectedRef));
      console.log('合约返回的真实投票结果:', realResults);
      
      // 转换为数字数组
      const counts = Array.from(realResults).map((result: any) => Number(result));
      
      setPublicCounts(counts);
      setMessage(`🎉 公投 ${selectedRef} 真实结果解密成功！总票数: ${counts.reduce((a, b) => a + b, 0)}
      
真实投票结果:
${m.options.map((option, index) => `${option}: ${counts[index]} 票`).join('\n')}`);
      
    } catch (error: any) {
      console.error('解密真实结果失败:', error);
      setMessage(`解密失败: ${error.message}`);
      setPublicCounts(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">管理中心</h1>
              <p className="text-gray-600 mt-1">创建公投、查看统计数据</p>
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

        {/* Contract Info */}
        <div className="mb-8 card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">合约信息</h2>
              <p className="text-gray-600 text-sm">地址: {deployment?.address ?? "未部署"}</p>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/vote" className="btn-primary text-sm py-2 px-4">
                🗳️ 去投票
              </Link>
              <button onClick={refreshCount} className="btn-secondary text-sm py-2 px-4">
                刷新
              </button>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-800">{refCount}</div>
                <div className="text-sm text-gray-600">公投总数</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Create Referendum */}
          <div className="card-gradient">
            <div className="flex items-center mb-6">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-800">发起公投</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">标题</label>
                <input
                  className="input-field"
                  placeholder="请输入公投标题"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">简介</label>
                <textarea
                  className="input-field resize-none h-20"
                  placeholder="请输入公投简介"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">选项</label>
                <input
                  className="input-field"
                  placeholder="选项，用逗号分隔"
                  value={opts}
                  onChange={(e) => setOpts(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">截止时间</label>
                <input
                  className="input-field"
                  type="datetime-local"
                  value={new Date(deadlineSec * 1000).toISOString().slice(0, 16)}
                  onChange={(e) => setDeadlineSec(Math.floor(new Date(e.target.value).getTime() / 1000))}
                />
              </div>
              
              <div className="space-y-3">
                <button
                  onClick={createReferendum}
                  disabled={isLoading || !isConnected || !title.trim() || !desc.trim()}
                  className="btn-primary w-full"
                >
                  创建公投
                </button>
                       <button
                         onClick={async () => {
                           setTitle("测试公投");
                           setDesc("这是一个测试公投");
                           setOpts("赞成,反对");
                           // 设置1分钟后截止，便于测试
                           setDeadlineSec(Math.floor(Date.now() / 1000) + 60);
                           setTimeout(() => createReferendum(), 100);
                         }}
                         disabled={isLoading || !isConnected}
                         className="btn-secondary w-full text-sm"
                       >
                         🚀 快速创建测试公投 (1分钟后截止)
                       </button>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card-gradient">
            <div className="flex items-center mb-6">
              <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-blue-500 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-800">快速操作</h2>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                <h3 className="font-semibold text-blue-800 mb-2">🗳️ 参与投票</h3>
                <p className="text-sm text-blue-700 mb-3">
                  查看所有公投并进行投票，享受完全匿名的投票体验
                </p>
                <Link href="/vote" className="btn-primary w-full text-center block">
                  前往投票中心
                </Link>
              </div>
              
              <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
                <h3 className="font-semibold text-purple-800 mb-2">📊 查看结果</h3>
                <p className="text-sm text-purple-700 mb-3">
                  查看已结束公投的统计结果和数据分析
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input-field text-sm"
                    type="number"
                    placeholder="公投ID"
                    value={selectedRef}
                    onChange={(e) => setSelectedRef(Number(e.target.value))}
                  />
                  <button
                    onClick={loadMeta}
                    disabled={isLoading}
                    className="btn-secondary text-sm"
                  >
                    查看详情
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div className="mt-8 card-gradient">
          <div className="flex items-center mb-6">
            <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center mr-3">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800">结果统计</h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <button 
                onClick={() => {
                  console.log("Button clicked!");
                  console.log("Current states:", {
                    isLoading,
                    selectedRef,
                    isConnected,
                    contractRW: !!contractRW,
                    deployment: !!deployment
                  });
                  loadMeta();
                }} 
                disabled={isLoading || selectedRef < 0} 
                className="btn-secondary w-full"
              >
                加载公投详情
              </button>
              <p className="text-xs text-gray-500 mt-1">
                公投ID: {selectedRef} | 总数: {refCount} | 
                {selectedRef >= refCount ? "❌ 不存在" : "✅ 存在"}
              </p>
            </div>
            <div>
              <button 
                onClick={() => {
                  console.log('结束公投按钮被点击', { 
                    isLoading, 
                    selectedRef, 
                    isConnected, 
                    contractRW: !!contractRW, 
                    metaFinalized: meta?.finalized 
                  });
                  finalizeReferendum();
                }} 
                disabled={isLoading || selectedRef < 0 || !isConnected || !contractRW || !!(meta && meta.finalized)} 
                className="btn-warning w-full"
              >
                强制结束公投
              </button>
              <p className="text-xs text-gray-500 mt-1">
                强制结束公投（不检查截止时间）
                <br />
                <span className="text-red-500">
                  状态: {isLoading ? '加载中' : ''} 
                  {selectedRef < 0 ? '公投ID无效' : ''} 
                  {!isConnected ? '钱包未连接' : ''} 
                  {!contractRW ? '合约未初始化' : ''} 
                  {meta?.finalized ? '公投已结束' : ''}
                </span>
              </p>
            </div>
            <div>
              <button 
                onClick={() => {
                  console.log('解密真实结果按钮被点击', { isLoading, selectedRef, isConnected });
                  decryptRealResults();
                }} 
                disabled={isLoading || selectedRef < 0} 
                className="btn-primary w-full"
              >
                🔓 解密投票结果
              </button>
              <p className="text-xs text-gray-500 mt-1">
                解密并显示真实的投票数字
                <br />
                <span className="text-red-500">需要公投已结束且结果公开</span>
              </p>
            </div>
          </div>
        </div>

        {/* Meta Information */}
        {meta && (
          <div className="mt-6 card animate-fade-in">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">公投详情 (加密数据)</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-600">标题</div>
                <div className="font-medium text-gray-800">{meta.title}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">状态</div>
                <div>
                  <span className={meta.finalized ? "status-ended" : "status-active"}>
                    {meta.finalized ? "已结束" : "进行中"}
                  </span>
                </div>
              </div>
                     <div>
                       <div className="text-sm text-gray-600">截止时间</div>
                       <div className="font-medium text-gray-800">{new Date(meta.deadline * 1000).toLocaleString()}</div>
                       <div className="text-xs text-gray-500 mt-1">
                         {meta.deadline > Math.floor(Date.now() / 1000) ? 
                           `还有 ${Math.floor((meta.deadline - Math.floor(Date.now() / 1000)) / 60)} 分钟` : 
                           '已过截止时间'
                         }
                       </div>
                     </div>
              <div>
                <div className="text-sm text-gray-600">结果公开</div>
                <div>
                  <span className={meta.publicResult ? "status-active" : "status-ended"}>
                    {meta.publicResult ? "是" : "否"}
                  </span>
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-sm text-gray-600">简介</div>
                <div className="font-medium text-gray-800">{meta.description}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-sm text-gray-600">选项</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {meta.options.map((option, index) => (
                    <span key={index} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                      {index}: {option}
                    </span>
                  ))}
                </div>
              </div>
              
              {/* 加密数据展示 */}
              {meta.encryptedTallies && Array.isArray(meta.encryptedTallies) && meta.encryptedTallies.length > 0 && (
                <div className="md:col-span-2">
                  <div className="text-sm text-gray-600 mb-2">加密计票数据</div>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="text-xs text-gray-500 mb-2">各选项加密票数:</div>
                    {meta.encryptedTallies.map((tally, index) => (
                      <div key={index} className="text-xs font-mono text-gray-700 mb-1">
                        选项 {index}: {JSON.stringify(tally).substring(0, 50)}...
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 如果没有加密数据，显示提示 */}
              {meta.encryptedTallies && (!Array.isArray(meta.encryptedTallies) || meta.encryptedTallies.length === 0) && (
                <div className="md:col-span-2">
                  <div className="text-sm text-gray-600 mb-2">加密计票数据</div>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="text-xs text-gray-500">暂无加密数据或数据格式错误</div>
                    <div className="text-xs text-gray-400 mt-1">
                      数据类型: {typeof meta.encryptedTallies} | 
                      是否为数组: {Array.isArray(meta.encryptedTallies) ? '是' : '否'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chart */}
        {meta && publicCounts && (
          <div className="mt-6 card animate-fade-in">
            <h3 className="text-lg font-semibold text-green-600 mb-4">🔓 真实投票结果</h3>
            <div className="h-80">
              <Bar
                data={{
                  labels: meta.options,
                  datasets: [
                    {
                      label: "真实票数",
                      data: publicCounts,
                      backgroundColor: "rgba(34, 197, 94, 0.6)",
                      borderColor: "rgba(34, 197, 94, 1)",
                      borderWidth: 2,
                      borderRadius: 8,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false,
                    },
                    tooltip: {
                      backgroundColor: "rgba(0, 0, 0, 0.8)",
                      titleColor: "white",
                      bodyColor: "white",
                      cornerRadius: 8,
                    },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        precision: 0,
                        color: "#6b7280",
                      },
                      grid: {
                        color: "#f3f4f6",
                      },
                    },
                    x: {
                      ticks: {
                        color: "#6b7280",
                      },
                      grid: {
                        display: false,
                      },
                    },
                  },
                }}
              />
            </div>
            <div className="mt-4 flex justify-center">
              <div className="text-sm text-gray-600">
                总票数: {publicCounts.reduce((a, b) => a + b, 0)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}