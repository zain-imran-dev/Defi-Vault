const hre = require("hardhat");

async function main() {
  // Replace these addresses with your deployed contract addresses
  const contracts = {
    dvtToken: "0x...", // Replace with actual address
    liquidityPool: "0x...", // Replace with actual address
    masterChef: "0x...", // Replace with actual address
    referralSystem: "0x..." // Replace with actual address
  };

  console.log("Starting contract verification...");

  try {
    // Verify DVT Token
    console.log("Verifying DVT Token...");
    await hre.run("verify:verify", {
      address: contracts.dvtToken,
      constructorArguments: [
        "DeFiVault Token",
        "DVT",
        "1000000000000000000000000" // 1M tokens
      ],
    });
    console.log("✅ DVT Token verified");

    // Verify Liquidity Pool
    console.log("Verifying Liquidity Pool...");
    await hre.run("verify:verify", {
      address: contracts.liquidityPool,
      constructorArguments: [
        contracts.dvtToken,
        "0x..." // Fee recipient address
      ],
    });
    console.log("✅ Liquidity Pool verified");

    // Verify MasterChef
    console.log("Verifying MasterChef...");
    await hre.run("verify:verify", {
      address: contracts.masterChef,
      constructorArguments: [
        contracts.dvtToken,
        "0x...", // Dev address
        "0x...", // Fee address
        "10000000000000000000", // 10 DVT per block
        "0" // Start block
      ],
    });
    console.log("✅ MasterChef verified");

    // Verify ReferralSystem
    console.log("Verifying ReferralSystem...");
    await hre.run("verify:verify", {
      address: contracts.referralSystem,
      constructorArguments: [
        contracts.dvtToken,
        contracts.masterChef
      ],
    });
    console.log("✅ ReferralSystem verified");

    console.log("🎉 All contracts verified successfully!");

  } catch (error) {
    console.error("❌ Verification failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });