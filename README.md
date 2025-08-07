# DeFiVault (DVT) - BSC DeFi Ecosystem

A comprehensive DeFi ecosystem built on Binance Smart Chain (BSC) featuring a native token, liquidity pool, yield farming, and multi-level referral system.

## 🚀 Project Overview

DeFiVault is a complete DeFi platform that includes:

- **DVT Token**: ERC20 token with anti-whale protection and minting capabilities
- **Liquidity Pool**: AMM-style pool for DVT/BNB trading with price impact protection
- **MasterChef**: Yield farming contract for staking LP tokens to earn DVT rewards
- **Referral System**: Multi-level referral program with tiered commission structure

## 📋 Table of Contents

- [Features](#features)
- [Smart Contracts](#smart-contracts)
- [Installation](#installation)
- [Testing](#testing)
- [Deployment](#deployment)
- [Usage](#usage)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

### 🪙 DVT Token (MyToken.sol)
- **Maximum Supply**: 1 billion tokens
- **Anti-whale Protection**: Configurable max wallet and transaction limits
- **Minting System**: Controlled minting with role-based permissions
- **Pausable**: Emergency pause functionality
- **Exemptions**: Owner can exempt addresses from limits

### 💧 Liquidity Pool (LiquidityPool.sol)
- **AMM Model**: Constant product formula (x * y = k)
- **Trading Pairs**: DVT/BNB
- **Fee Structure**: Configurable swap fees (default 0.3%)
- **Price Impact Protection**: Maximum 10% price impact per trade
- **LP Tokens**: ERC20 LP tokens for liquidity providers
- **Protocol Fees**: 20% of fees go to protocol treasury

### 🌾 MasterChef (MasterChef.sol)
- **Yield Farming**: Stake LP tokens to earn DVT rewards
- **Multiple Pools**: Support for multiple LP token pools
- **Harvest Lockup**: Configurable lockup periods for rewards
- **Deposit Fees**: Configurable deposit fees per pool
- **Emergency Withdraw**: Emergency withdrawal functionality
- **APY Calculation**: Built-in APY calculation for pools

### 👥 Referral System (ReferralSystem.sol)
- **Multi-level Referrals**: Up to 3 levels deep
- **Tiered Commissions**: Bronze, Silver, Gold, Platinum tiers
- **Commission Structure**: 5%, 2%, 1% for levels 1, 2, 3
- **Anti-gaming**: Cooldown periods and activity tracking
- **Circular Reference Protection**: Prevents referral loops

## 🏗️ Smart Contracts

### Core Contracts

| Contract | Description | Key Features |
|----------|-------------|--------------|
| `MyToken.sol` | DVT ERC20 Token | Anti-whale, minting, pausable |
| `LiquidityPool.sol` | DVT/BNB AMM Pool | Trading, LP provision, fees |
| `MasterChef.sol` | Yield Farming | Staking, rewards, multiple pools |
| `ReferralSystem.sol` | Referral Program | Multi-level, tiered commissions |

### Key Parameters

#### DVT Token
- **Max Supply**: 1,000,000,000 DVT
- **Max Wallet**: 1% of total supply (10M DVT)
- **Max Transaction**: 0.5% of total supply (5M DVT)

#### Liquidity Pool
- **Swap Fee**: 0.3% (configurable)
- **Protocol Fee Share**: 20%
- **Max Price Impact**: 10%

#### MasterChef
- **Max Deposit Fee**: 10%
- **Max Harvest Lockup**: 14 days
- **Dev Fee**: 10% of rewards

#### Referral System
- **Max Levels**: 3
- **Max Commission Rate**: 20%
- **Activity Timeout**: 90 days

## 🛠️ Installation

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Git

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd bsc-proj
```

2. **Install dependencies**
```bash
npm install
```

3. **Compile contracts**
```bash
npx hardhat compile
```

## 🧪 Testing

Run the test suite to verify contract functionality:

```bash
npx hardhat test
```

### Test Coverage
- **MyToken.test.js**: Token functionality, limits, minting
- **LiquidityPool.test.js**: Trading, LP operations, fees
- **MasterChef.test.js**: Staking, rewards, pool management
- **ReferralSystem.test.js**: Referral logic, commissions

## 🚀 Deployment

### Prerequisites
- BSC RPC endpoint
- Private key for deployment
- BNB for gas fees

### Configuration

1. **Environment Setup**
```bash
# Create .env file
cp .env.example .env
```

2. **Configure Hardhat**
Update `hardhat.config.js` with your network settings:

```javascript
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.28",
  networks: {
    bsc: {
      url: process.env.BSC_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 56
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 97
    }
  }
};
```

3. **Deploy Contracts**
```bash
npx hardhat run scripts/deploy.js --network bscTestnet
```

### Deployment Order
1. Deploy `MyToken`
2. Deploy `LiquidityPool` (with token address)
3. Deploy `MasterChef` (with token address)
4. Deploy `ReferralSystem` (with token and MasterChef addresses)
5. Configure contracts and permissions

## 📖 Usage

### For Users

#### Staking LP Tokens
1. Add liquidity to DVT/BNB pool
2. Stake LP tokens in MasterChef
3. Harvest DVT rewards

#### Referral Program
1. Get referral link from referrer
2. Register with referral system
3. Earn commissions from referees' rewards

### For Developers

#### Integration Examples

**Check Token Balance**
```javascript
const token = await MyToken.attach(tokenAddress);
const balance = await token.balanceOf(userAddress);
```

**Get Pool Info**
```javascript
const masterChef = await MasterChef.attach(masterChefAddress);
const poolInfo = await masterChef.getPoolInfo(poolId);
```

**Calculate Pending Rewards**
```javascript
const pendingRewards = await masterChef.pendingDVT(poolId, userAddress);
```

## 🔒 Security

### Security Features
- **Reentrancy Protection**: All external calls protected
- **Access Control**: Role-based permissions
- **Input Validation**: Comprehensive parameter checks
- **Emergency Functions**: Pause and emergency withdrawal
- **Anti-whale Protection**: Transaction and wallet limits

### Audit Status
- Contracts follow OpenZeppelin standards
- Comprehensive test coverage
- Security best practices implemented

### Known Limitations
- Price oracle dependency for accurate APY
- Centralized fee collection
- Owner privileges for configuration

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow Solidity style guide
- Add comprehensive tests
- Update documentation
- Include gas optimization

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Documentation**: [Project Wiki](link-to-wiki)
- **Discord**: [Community Server](link-to-discord)
- **Telegram**: [Official Channel](link-to-telegram)
- **Email**: support@defivault.com

## 🙏 Acknowledgments

- OpenZeppelin for secure contract libraries
- SushiSwap for MasterChef inspiration
- Binance Smart Chain community
- All contributors and testers

---

**⚠️ Disclaimer**: This software is provided "as is" without warranty. Use at your own risk. Always conduct thorough testing before deploying to mainnet.
