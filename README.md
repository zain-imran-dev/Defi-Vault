# DeFiVault (DVT) - BSC DeFi Ecosystem

A DeFi platform on Binance Smart Chain featuring DVT token, liquidity pool, yield farming, and referral system.

## Core Features

**DVT Token**
- 1B max supply with anti-whale protection
- Max wallet: 1% (10M DVT), Max tx: 0.5% (5M DVT)
- Controlled minting with role-based permissions

**Liquidity Pool**
- DVT/BNB AMM with 0.3% swap fees
- 10% max price impact protection
- 20% protocol fee share

**MasterChef Farming**
- Stake LP tokens to earn DVT rewards
- Configurable deposit fees and harvest lockup
- Built-in APY calculation

**Referral System**
- 3-level structure: 5%, 2%, 1% commissions
- Tiered system: Bronze, Silver, Gold, Platinum
- Anti-gaming protection

## Smart Contracts

| Contract | Purpose | Key Features |
|----------|---------|--------------|
| MyToken.sol | DVT Token | Anti-whale, minting, pausable |
| LiquidityPool.sol | AMM Trading | LP provision, fees, price impact |
| MasterChef.sol | Yield Farming | Multi-pool staking, rewards |
| ReferralSystem.sol | Referrals | Multi-level commissions |

## Quick Setup

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to BSC testnet
npx hardhat run scripts/deploy.js --network bscTestnet
```

## Usage Examples

**Stake LP Tokens:**
1. Add DVT/BNB liquidity
2. Stake LP tokens in MasterChef
3. Harvest DVT rewards

**Join Referral Program:**
1. Register with referrer's link
2. Earn commissions from referees
3. Upgrade tier based on activity

## Security Features

- OpenZeppelin standards compliance
- Reentrancy protection
- Access control with role-based permissions
- Emergency pause functionality
- Comprehensive input validation

## Configuration

```javascript
// hardhat.config.js
module.exports = {
  solidity: "0.8.28",
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 97
    }
  }
};
```

## Deployment Order

1. Deploy MyToken
2. Deploy LiquidityPool (with token address)
3. Deploy MasterChef (with token address)  
4. Deploy ReferralSystem (with token and MasterChef addresses)
5. Configure permissions

---

**⚠️ Disclaimer:** Use at your own risk. Always test thoroughly before mainnet deployment.
