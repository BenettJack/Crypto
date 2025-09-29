"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "../hooks/useWallet";

export default function Navigation() {
  const pathname = usePathname();
  const { account, chainId, isConnected, isConnecting, connect } = useWallet();

  const navItems = [
    { href: "/", label: "首页", icon: "🏠" },
    { href: "/vote", label: "投票中心", icon: "🗳️" },
  ];

  return (
    <nav className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">CR</span>
              </div>
              <span className="font-bold text-xl gradient-text">CryptoReferendum</span>
            </Link>
            
            <div className="hidden md:flex space-x-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    <span className="mr-2">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Wallet Connection */}
          <div className="flex items-center space-x-4">
            {isConnected ? (
              <div className="flex items-center space-x-3">
                <div className="text-sm text-gray-600">
                  <div className="hidden md:block">账户: {account?.slice(0, 6)}...{account?.slice(-4)}</div>
                  <div className="hidden md:block">链ID: {chainId}</div>
                  <div className="md:hidden text-xs">
                    {account?.slice(0, 4)}...{account?.slice(-2)}
                  </div>
                </div>
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
              </div>
            ) : (
              <button
                onClick={connect}
                disabled={isConnecting}
                className="btn-primary text-sm px-4 py-2"
              >
                {isConnecting ? "连接中..." : "连接钱包"}
              </button>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden ml-4">
            <div className="flex space-x-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`p-2 rounded-lg transition-all duration-200 ${
                      isActive
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                    title={item.label}
                  >
                    <span className="text-lg">{item.icon}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
