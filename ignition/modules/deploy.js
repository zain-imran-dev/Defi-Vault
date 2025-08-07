const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("DeployModule", (m) => {
  // Parameters with default values for BSC Testnet
  const tokenName = m.getParameter("tokenName", "DeFiVault Token");
  const tokenSymbol = m.getParameter("tokenSymbol", "DVT");
  const initialSupply = m.getParameter("initialSupply", "1000000000000000000000000"); // 1M tokens in wei
  const dvtPerBlock = m.getParameter("dvtPerBlock", "10000000000000000000"); // 10 DVT per block
  const startBlock = m.getParameter("startBlock", "0"); // Will be set to current block + 100

  // Deploy DVT Token
  const dvtToken = m.contract("MyToken", [tokenName, tokenSymbol, initialSupply], {
    id: "DVTToken"
  });

  // Deploy Liquidity Pool
  const liquidityPool = m.contract("LiquidityPool", [
    dvtToken,
    m.getAccount(0) // Fee recipient (deployer initially)
  ], {
    id: "LiquidityPool"
  });

  // Deploy MasterChef
  const masterChef = m.contract("MasterChef", [
    dvtToken,
    m.getAccount(0), // Dev address (deployer initially)
    m.getAccount(0), // Fee address (deployer initially)
    dvtPerBlock,
    startBlock
  ], {
    id: "MasterChef"
  });

  // Deploy ReferralSystem
  const referralSystem = m.contract("ReferralSystem", [
    dvtToken,
    masterChef
  ], {
    id: "ReferralSystem"
  });

  // After deployment setup calls
  
  // Add MasterChef as minter for DVT
  m.call(dvtToken, "addMinter", [masterChef], {
    id: "AddMasterChefMinter"
  });

  // Add ReferralSystem as minter for DVT
  m.call(dvtToken, "addMinter", [referralSystem], {
    id: "AddReferralSystemMinter"
  });

  // Set ReferralSystem as operator in MasterChef (if needed)
  m.call(referralSystem, "setOperator", [masterChef, true], {
    id: "SetMasterChefOperator"
  });

  // Exempt LiquidityPool and MasterChef from anti-whale limits
  m.call(dvtToken, "setExemptFromLimits", [liquidityPool, true], {
    id: "ExemptLiquidityPool"
  });

  m.call(dvtToken, "setExemptFromLimits", [masterChef, true], {
    id: "ExemptMasterChef"
  });

  // Add initial LP pool to MasterChef
  m.call(masterChef, "add", [
    1000, // allocation points
    liquidityPool, // LP token
    100, // 1% deposit fee
    3600, // 1 hour harvest lockup
    false // don't mass update pools
  ], {
    id: "AddLPPool"
  });

  return {
    dvtToken,
    liquidityPool,
    masterChef,
    referralSystem
  };
});