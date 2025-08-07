const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("MyTokenModule", (m) => {
  // Parameters with default values
  const tokenName = m.getParameter("tokenName", "DeFiVault Token");
  const tokenSymbol = m.getParameter("tokenSymbol", "DVT");
  const initialSupply = m.getParameter("initialSupply", "1000000000000000000000000"); // 1M tokens in wei

  // Deploy MyToken contract
  const myToken = m.contract("MyToken", [tokenName, tokenSymbol, initialSupply]);

  return { myToken };
});