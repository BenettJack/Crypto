import './globals.css'
import Navigation from '../components/Navigation'
import { WalletProvider } from '../hooks/useWallet'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <WalletProvider>
          <Navigation />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}

