const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let MyToken, LiquidityPool;
  let myToken, liquidityPool;
  let owner, addr1, addr2, feeRecipient;

  const INITIAL_TOKEN_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_ETH_LIQUIDITY = ethers.parseEther("100");
  const INITIAL_TOKEN_LIQUIDITY = ethers.parseEther("100000");

  beforeEach(async function () {
    [owner, addr1, addr2, feeRecipient] = await ethers.getSigners();

    // Deploy MyToken
    MyToken = await ethers.getContractFactory("MyToken");
    myToken = await MyToken.deploy("DeFiVault Token", "DVT", INITIAL_TOKEN_SUPPLY);
    await myToken.waitForDeployment();

    // Deploy LiquidityPool
    LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    liquidityPool = await LiquidityPool.deploy(
      await myToken.getAddress(),
      feeRecipient.address
    );
    await liquidityPool.waitForDeployment();

    // Approve tokens for liquidity pool
    await myToken.approve(await liquidityPool.getAddress(), ethers.parseEther("500000"));
    await myToken.connect(addr1).approve(await liquidityPool.getAddress(), ethers.parseEther("50000"));
    await myToken.connect(addr2).approve(await liquidityPool.getAddress(), ethers.parseEther("50000"));

    // Transfer some tokens to test accounts
    await myToken.transfer(addr1.address, ethers.parseEther("50000"));
    await myToken.transfer(addr2.address, ethers.parseEther("50000"));
  });

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      expect(await liquidityPool.token()).to.equal(await myToken.getAddress());
    });

    it("Should set the correct fee recipient", async function () {
      expect(await liquidityPool.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should have correct initial values", async function () {
      expect(await liquidityPool.swapFee()).to.equal(30); // 0.3%
      expect(await liquidityPool.protocolFeeShare()).to.equal(2000); // 20%
      expect(await liquidityPool.maxPriceImpact()).to.equal(1000); // 10%
    });
  });

  describe("Add Liquidity", function () {
    it("Should add initial liquidity", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

      await expect(
        liquidityPool.addLiquidity(
          INITIAL_TOKEN_LIQUIDITY,
          INITIAL_TOKEN_LIQUIDITY,
          INITIAL_ETH_LIQUIDITY,
          owner.address,
          deadline,
          { value: INITIAL_ETH_LIQUIDITY }
        )
      ).to.emit(liquidityPool, "Mint");

      const [reserveETH, reserveToken] = await liquidityPool.getReserves();
      expect(reserveETH).to.equal(INITIAL_ETH_LIQUIDITY);
      expect(reserveToken).to.equal(INITIAL_TOKEN_LIQUIDITY);

      const lpBalance = await liquidityPool.balanceOf(owner.address);
      expect(lpBalance).to.be.gt(0);
    });

    it("Should add proportional liquidity after initial", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // Add initial liquidity
      await liquidityPool.addLiquidity(
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_ETH_LIQUIDITY,
        owner.address,
        deadline,
        { value: INITIAL_ETH_LIQUIDITY }
      );

      // Add more liquidity proportionally
      const addETH = ethers.parseEther("50");
      const addToken = ethers.parseEther("50000");

      await liquidityPool.connect(addr1).addLiquidity(
        addToken,
        addToken,
        addETH,
        addr1.address,
        deadline,
        { value: addETH }
      );

      const lpBalance = await liquidityPool.balanceOf(addr1.address);
      expect(lpBalance).to.be.gt(0);
    });

    it("Should refund excess ETH", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const excessETH = ethers.parseEther("10");

      // Should succeed and refund excess ETH
      await expect(
        liquidityPool.addLiquidity(
          INITIAL_TOKEN_LIQUIDITY,
          INITIAL_TOKEN_LIQUIDITY,
          INITIAL_ETH_LIQUIDITY,
          owner.address,
          deadline,
          { value: INITIAL_ETH_LIQUIDITY + excessETH }
        )
      ).to.not.be.reverted;
    });

    it("Should revert with expired deadline", async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago

      await expect(
        liquidityPool.addLiquidity(
          INITIAL_TOKEN_LIQUIDITY,
          INITIAL_TOKEN_LIQUIDITY,
          INITIAL_ETH_LIQUIDITY,
          owner.address,
          pastDeadline,
          { value: INITIAL_ETH_LIQUIDITY }
        )
      ).to.be.revertedWith("LiquidityPool: EXPIRED");
    });
  });

  describe("Remove Liquidity", function () {
    beforeEach(async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      await liquidityPool.addLiquidity(
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_ETH_LIQUIDITY,
        owner.address,
        deadline,
        { value: INITIAL_ETH_LIQUIDITY }
      );
    });

    it("Should remove liquidity", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const lpBalance = await liquidityPool.balanceOf(owner.address);
      const removeAmount = lpBalance / 2n;

      const ethBalanceBefore = await ethers.provider.getBalance(owner.address);
      const tokenBalanceBefore = await myToken.balanceOf(owner.address);

      await expect(
        liquidityPool.removeLiquidity(
          removeAmount,
          0, // min token amount
          0, // min ETH amount
          owner.address,
          deadline
        )
      ).to.emit(liquidityPool, "Burn");

      const ethBalanceAfter = await ethers.provider.getBalance(owner.address);
      const tokenBalanceAfter = await myToken.balanceOf(owner.address);

      expect(ethBalanceAfter).to.be.gt(ethBalanceBefore);
      expect(tokenBalanceAfter).to.be.gt(tokenBalanceBefore);
    });

    it("Should revert if insufficient liquidity amount", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const lpBalance = await liquidityPool.balanceOf(owner.address);

      await expect(
        liquidityPool.removeLiquidity(
          lpBalance,
          ethers.parseEther("200000"), // Too high minimum token amount
          0,
          owner.address,
          deadline
        )
      ).to.be.revertedWith("LiquidityPool: INSUFFICIENT_TOKEN_AMOUNT");
    });
  });

  describe("Swapping", function () {
    beforeEach(async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      await liquidityPool.addLiquidity(
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_ETH_LIQUIDITY,
        owner.address,
        deadline,
        { value: INITIAL_ETH_LIQUIDITY }
      );
    });

    it("Should swap ETH for tokens", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const ethAmount = ethers.parseEther("1");
      
      const tokenBalanceBefore = await myToken.balanceOf(addr1.address);
      const expectedOutput = await liquidityPool.getAmountOut(
        ethAmount,
        INITIAL_ETH_LIQUIDITY,
        INITIAL_TOKEN_LIQUIDITY
      );

      await expect(
        liquidityPool.connect(addr1).swapExactETHForTokens(
          0, // min output
          addr1.address,
          deadline,
          { value: ethAmount }
        )
      ).to.emit(liquidityPool, "Swap");

      const tokenBalanceAfter = await myToken.balanceOf(addr1.address);
      const actualOutput = tokenBalanceAfter - tokenBalanceBefore;

      expect(actualOutput).to.be.closeTo(expectedOutput, ethers.parseEther("10"));
    });

    it("Should swap tokens for ETH", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const tokenAmount = ethers.parseEther("1000");
      
      const ethBalanceBefore = await ethers.provider.getBalance(addr1.address);
      const expectedOutput = await liquidityPool.getAmountOut(
        tokenAmount,
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_ETH_LIQUIDITY
      );

      const tx = await liquidityPool.connect(addr1).swapExactTokensForETH(
        tokenAmount,
        0, // min output
        addr1.address,
        deadline
      );

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const ethBalanceAfter = await ethers.provider.getBalance(addr1.address);

      const actualOutput = ethBalanceAfter - ethBalanceBefore + gasUsed;
      expect(actualOutput).to.be.closeTo(expectedOutput, ethers.parseEther("0.01"));
    });

    it("Should revert if output amount is too low", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const ethAmount = ethers.parseEther("1");
      const minOutput = ethers.parseEther("100000"); // Unrealistically high

      await expect(
        liquidityPool.connect(addr1).swapExactETHForTokens(
          minOutput,
          addr1.address,
          deadline,
          { value: ethAmount }
        )
      ).to.be.revertedWith("LiquidityPool: INSUFFICIENT_OUTPUT_AMOUNT");
    });

    it("Should respect price impact limits", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const largeEthAmount = ethers.parseEther("20"); // 20% of pool
      
      await expect(
        liquidityPool.connect(addr1).swapExactETHForTokens(
          0,
          addr1.address,
          deadline,
          { value: largeEthAmount }
        )
      ).to.be.revertedWith("LiquidityPool: PRICE_IMPACT_TOO_HIGH");
    });
  });

  describe("Fee Management", function () {
    it("Should allow owner to update swap fee", async function () {
      const newFee = 50; // 0.5%
      
      await expect(liquidityPool.setSwapFee(newFee))
        .to.emit(liquidityPool, "SwapFeeUpdated")
        .withArgs(newFee);

      expect(await liquidityPool.swapFee()).to.equal(newFee);
    });

    it("Should not allow setting fee too high", async function () {
      const tooHighFee = 1500; // 15%
      
      await expect(
        liquidityPool.setSwapFee(tooHighFee)
      ).to.be.revertedWith("LiquidityPool: fee too high");
    });

    it("Should allow owner to update fee recipient", async function () {
      await expect(liquidityPool.setFeeRecipient(addr1.address))
        .to.emit(liquidityPool, "FeeRecipientUpdated")
        .withArgs(addr1.address);

      expect(await liquidityPool.feeRecipient()).to.equal(addr1.address);
    });
  });

  describe("Price Functions", function () {
    beforeEach(async function () {
      const deadline = Math.floor(Date.now() / 1000) + 300;
      await liquidityPool.addLiquidity(
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_TOKEN_LIQUIDITY,
        INITIAL_ETH_LIQUIDITY,
        owner.address,
        deadline,
        { value: INITIAL_ETH_LIQUIDITY }
      );
    });

    it("Should return correct price", async function () {
      const price = await liquidityPool.getPrice();
      const expectedPrice = (INITIAL_TOKEN_LIQUIDITY * ethers.parseEther("1")) / INITIAL_ETH_LIQUIDITY;
      expect(price).to.equal(expectedPrice);
    });

    it("Should calculate output amount correctly", async function () {
      const inputAmount = ethers.parseEther("1");
      const outputAmount = await liquidityPool.getAmountOut(
        inputAmount,
        INITIAL_ETH_LIQUIDITY,
        INITIAL_TOKEN_LIQUIDITY
      );

      // Manual calculation with 0.3% fee
      const fee = 30;
      const amountInWithFee = inputAmount * BigInt(10000 - fee);
      const numerator = amountInWithFee * INITIAL_TOKEN_LIQUIDITY;
      const denominator = INITIAL_ETH_LIQUIDITY * 10000n + amountInWithFee;
      const expectedOutput = numerator / denominator;

      expect(outputAmount).to.equal(expectedOutput);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw", async function () {
      // Send some ETH to the contract
      await owner.sendTransaction({
        to: await liquidityPool.getAddress(),
        value: ethers.parseEther("1")
      });

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      await liquidityPool.emergencyWithdraw(ethers.ZeroAddress, ethers.parseEther("1"));
      const balanceAfter = await ethers.provider.getBalance(owner.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should not allow non-owner to emergency withdraw", async function () {
      await expect(
        liquidityPool.connect(addr1).emergencyWithdraw(ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(liquidityPool, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero reserves correctly", async function () {
      const price = await liquidityPool.getPrice();
      expect(price).to.equal(0);
    });

    it("Should revert getAmountOut with zero input", async function () {
      await expect(
        liquidityPool.getAmountOut(0, ethers.parseEther("100"), ethers.parseEther("100000"))
      ).to.be.revertedWith("LiquidityPool: INSUFFICIENT_INPUT_AMOUNT");
    });

    it("Should revert getAmountOut with zero reserves", async function () {
      await expect(
        liquidityPool.getAmountOut(ethers.parseEther("1"), 0, ethers.parseEther("100000"))
      ).to.be.revertedWith("LiquidityPool: INSUFFICIENT_LIQUIDITY");
    });
  });
});