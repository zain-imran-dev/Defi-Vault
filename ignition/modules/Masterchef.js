const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("MasterChefModule", (m) => {
  // Parameters
  const dvtAddress = m.getParameter("dvtAddress");
  const devAddress = m.getParameter("devAddress", m.getAccount(0));
  const feeAddress = m.getParameter("feeAddress", m.getAccount(0));
  const dvtPerBlock = m.getParameter("dvtPerBlock", "10000000000000000000"); // 10 DVT per block
  const startBlock = m.getParameter("startBlock", "0");

  // Deploy MasterChef contract
  const masterChef = m.contract("MasterChef", [
    dvtAddress,
    devAddress,
    feeAddress,
    dvtPerBlock,
    startBlock
  ]);

  return { masterChef };
});