const { ethers } = require("hardhat");

async function main() {
  // Contract addresses (replace with actual deployed addresses)
  const DVT_TOKEN_ADDRESS = "YOUR_DVT_TOKEN_ADDRESS";
  const LIQUIDITY_POOL_ADDRESS = "YOUR_LIQUIDITY_POOL_ADDRESS";
  const MASTERCHEF_ADDRESS = "YOUR_MASTERCHEF_ADDRESS";
  const REFERRAL_SYSTEM_ADDRESS = "YOUR_REFERRAL_SYSTEM_ADDRESS";

  console.log("Verifying contracts on BSCScan...");

  // Verify DVT Token
  console.log("\n=== Verifying DVT Token ===");
  try {
    await hre.run("verify:verify", {
      address: DVT_TOKEN_ADDRESS,
      constructorArguments: [
        "DeFiVault Token",
        "DVT",
        ethers.utils.parseEther("100000000") // 100M initial supply
      ],
    });
    console.log("DVT Token verified successfully");
  } catch (error) {
    console.log("DVT Token verification failed:", error.message);
  }

  // Verify Liquidity Pool
  console.log("\n=== Verifying Liquidity Pool ===");
  try {
    await hre.run("verify:verify", {
      address: LIQUIDITY_POOL_ADDRESS,
      constructorArguments: [
        DVT_TOKEN_ADDRESS,
        "YOUR_FEE_RECIPIENT_ADDRESS" // Replace with actual fee recipient
      ],
    });
    console.log("Liquidity Pool verified successfully");
  } catch (error) {
    console.log("Liquidity Pool verification failed:", error.message);
  }

  // Verify MasterChef
  console.log("\n=== Verifying MasterChef ===");
  try {
    await hre.run("verify:verify", {
      address: MASTERCHEF_ADDRESS,
      constructorArguments: [
        DVT_TOKEN_ADDRESS,
        "YOUR_DEV_ADDRESS", // Replace with actual dev address
        "YOUR_FEE_ADDRESS", // Replace with actual fee address
        ethers.utils.parseEther("1"), // 1 DVT per block
        0 // start block (replace with actual start block)
      ],
    });
    console.log("MasterChef verified successfully");
  } catch (error) {
    console.log("MasterChef verification failed:", error.message);
  }

  // Verify Referral System
  console.log("\n=== Verifying Referral System ===");
  try {
    await hre.run("verify:verify", {
      address: REFERRAL_SYSTEM_ADDRESS,
      constructorArguments: [
        DVT_TOKEN_ADDRESS,
        MASTERCHEF_ADDRESS
      ],
    });
    console.log("Referral System verified successfully");
  } catch (error) {
    console.log("Referral System verification failed:", error.message);
  }

  console.log("\n=== Verification Complete ===");
  console.log("Check BSCScan for verification status");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 