"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { BrowserProvider } from "ethers";
import { JsonRpcProvider } from "ethers";
import { MockFhevmInstance } from "@fhevm/mock-utils";

interface WalletContextType {
  account: string | undefined;
  chainId: number;
  isConnected: boolean;
  isConnecting: boolean;
  fhevm: any | undefined;
  connect: () => Promise<void>;
  disconnect: () => void;
  provider: BrowserProvider | undefined;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | undefined>();
  const [chainId, setChainId] = useState<number>(31337);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [fhevm, setFhevm] = useState<any | undefined>();
  const [provider, setProvider] = useState<BrowserProvider | undefined>();
  const [rpcUrl] = useState<string>("http://127.0.0.1:8545");

  // 检查是否已连接
  const isConnected = !!account;

  // 初始化时检查是否已连接
  useEffect(() => {
    checkConnection();
    
    // 监听账户变化
    if ((window as any).ethereum) {
      (window as any).ethereum.on('accountsChanged', handleAccountsChanged);
      (window as any).ethereum.on('chainChanged', handleChainChanged);
      (window as any).ethereum.on('disconnect', handleDisconnect);
    }

    return () => {
      if ((window as any).ethereum) {
        (window as any).ethereum.removeListener('accountsChanged', handleAccountsChanged);
        (window as any).ethereum.removeListener('chainChanged', handleChainChanged);
        (window as any).ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, []);

  const checkConnection = async () => {
    if (!(window as any).ethereum) return;
    
    try {
      // 检查是否已经连接
      const accounts = await (window as any).ethereum.request({ 
        method: 'eth_accounts' 
      });
      
      if (accounts.length > 0) {
        // 如果已连接，恢复连接状态
        await restoreConnection();
      }
    } catch (error) {
      console.log('检查连接状态失败:', error);
    }
  };

  const restoreConnection = async () => {
    try {
      const browserProvider = new BrowserProvider((window as any).ethereum);
      const signer = await browserProvider.getSigner();
      const address = await signer.getAddress();
      const network = await browserProvider.getNetwork();
      
      setAccount(address);
      setChainId(Number(network.chainId));
      setProvider(browserProvider);
      
      // 初始化 FHEVM 实例
      await initializeFhevm(browserProvider);
    } catch (error) {
      console.log('恢复连接失败:', error);
    }
  };

  const initializeFhevm = async (browserProvider: BrowserProvider) => {
    try {
      const jsonRpc = new JsonRpcProvider(rpcUrl);
      const metaRes = await fetch("/fhevm-metadata.json").catch(() => null);
      const metadata = metaRes && metaRes.ok ? await metaRes.json() : null;
      
      if (!metadata) {
        console.log('缺少 FHEVM 元信息');
        return;
      }

      const network = await browserProvider.getNetwork();
      const instance = await MockFhevmInstance.create(jsonRpc, jsonRpc, {
        aclContractAddress: metadata.ACLAddress,
        chainId: Number(network.chainId),
        gatewayChainId: 55815,
        inputVerifierContractAddress: metadata.InputVerifierAddress,
        kmsContractAddress: metadata.KMSVerifierAddress,
        verifyingContractAddressDecryption: metadata.VerifyingDecryption,
        verifyingContractAddressInputVerification: metadata.VerifyingInput,
      });
      
      setFhevm(instance);
    } catch (error) {
      console.log('初始化 FHEVM 失败:', error);
    }
  };

  const connect = async () => {
    if (!(window as any).ethereum) {
      alert("请安装 MetaMask");
      return;
    }
    
    setIsConnecting(true);
    
    try {
      // 请求连接账户
      await (window as any).ethereum.request({
        method: 'eth_requestAccounts',
      });
      
      await restoreConnection();
    } catch (error: any) {
      console.error('连接失败:', error);
      alert(`连接失败: ${error.message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setAccount(undefined);
    setProvider(undefined);
    setFhevm(undefined);
    setChainId(31337);
  };

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      disconnect();
    } else {
      // 账户变化时重新连接
      restoreConnection();
    }
  };

  const handleChainChanged = (chainId: string) => {
    // 链变化时重新加载页面（推荐做法）
    window.location.reload();
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        isConnected,
        isConnecting,
        fhevm,
        connect,
        disconnect,
        provider,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}


