const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ReferralSystemModule", (m) => {
  // Parameters
  const dvtAddress = m.getParameter("dvtAddress");
  const masterChefAddress = m.getParameter("masterChefAddress");

  // Deploy ReferralSystem contract
  const referralSystem = m.contract("ReferralSystem", [
    dvtAddress,
    masterChefAddress
  ]);

  return { referralSystem };
});