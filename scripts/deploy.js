const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy DVT Token
  console.log("\n=== Deploying DVT Token ===");
  const MyToken = await ethers.getContractFactory("MyToken");
  const token = await MyToken.deploy(
    "DeFiVault Token",
    "DVT",
    ethers.utils.parseEther("100000000") // 100M initial supply
  );
  await token.deployed();
  console.log("DVT Token deployed to:", token.address);

  // Deploy Liquidity Pool
  console.log("\n=== Deploying Liquidity Pool ===");
  const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
  const liquidityPool = await LiquidityPool.deploy(
    token.address,
    deployer.address // fee recipient
  );
  await liquidityPool.deployed();
  console.log("Liquidity Pool deployed to:", liquidityPool.address);

  // Deploy MasterChef
  console.log("\n=== Deploying MasterChef ===");
  const MasterChef = await ethers.getContractFactory("MasterChef");
  const masterChef = await MasterChef.deploy(
    token.address,
    deployer.address, // dev address
    deployer.address, // fee address
    ethers.utils.parseEther("1"), // 1 DVT per block
    await ethers.provider.getBlockNumber() + 100 // start block
  );
  await masterChef.deployed();
  console.log("MasterChef deployed to:", masterChef.address);

  // Deploy Referral System
  console.log("\n=== Deploying Referral System ===");
  const ReferralSystem = await ethers.getContractFactory("ReferralSystem");
  const referralSystem = await ReferralSystem.deploy(
    token.address,
    masterChef.address
  );
  await referralSystem.deployed();
  console.log("Referral System deployed to:", referralSystem.address);

  // Configure contracts
  console.log("\n=== Configuring Contracts ===");
  
  // Add MasterChef as minter for DVT token
  await token.addMinter(masterChef.address);
  console.log("MasterChef added as DVT minter");

  // Add Liquidity Pool as minter for DVT token
  await token.addMinter(liquidityPool.address);
  console.log("Liquidity Pool added as DVT minter");

  // Add Referral System as minter for DVT token
  await token.addMinter(referralSystem.address);
  console.log("Referral System added as DVT minter");

  // Add LP token pool to MasterChef
  await masterChef.add(
    1000, // alloc points
    liquidityPool.address, // LP token
    0, // deposit fee (0%)
    0, // harvest lockup (0 days)
    false // don't update pools
  );
  console.log("LP token pool added to MasterChef");

  // Set Referral System as operator in MasterChef
  await referralSystem.setOperator(masterChef.address, true);
  console.log("Referral System set as MasterChef operator");

  console.log("\n=== Deployment Complete ===");
  console.log("DVT Token:", token.address);
  console.log("Liquidity Pool:", liquidityPool.address);
  console.log("MasterChef:", masterChef.address);
  console.log("Referral System:", referralSystem.address);

  // Save deployment info
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    deployer: deployer.address,
    contracts: {
      dvtToken: token.address,
      liquidityPool: liquidityPool.address,
      masterChef: masterChef.address,
      referralSystem: referralSystem.address
    },
    timestamp: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber()
  };

  console.log("\nDeployment Info:", JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 