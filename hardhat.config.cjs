require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

const { BASE_RPC_URL, PRIVATE_KEY } = process.env;

module.exports = {
  solidity: "0.8.20",
  networks: {
    base: {
      url: BASE_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
