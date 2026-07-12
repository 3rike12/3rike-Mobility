// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TricycleNFT} from "../src/TricycleNFT.sol";
import {FractionalInvestment} from "../src/FractionalInvestment.sol";

/// @notice Deploys the investment stack to Arc and seeds a few demo tricycles
///         + open pools so the app has data to show. USDC defaults to Arc's
///         canonical Circle USDC (0x3600…0000); override with USDC_ADDRESS.
contract DeployInvestment is Script {
    address constant DEFAULT_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envOr("USDC_ADDRESS", DEFAULT_USDC);

        vm.startBroadcast(pk);

        TricycleNFT nft = new TricycleNFT(deployer);
        FractionalInvestment inv = new FractionalInvestment(IERC20(usdc), nft, deployer);

        // Seed demo tricycles. pricePerShare = 1 USDC, so totalShares == priceUsd
        // (1 share = $1) — easy to demo with small amounts.
        _seed(nft, inv, deployer, "RDB-001", "Bajaj", "RE", false, 2500, 110); // classic yellow keke
        _seed(nft, inv, deployer, "RDB-002", "Mahindra", "Treo", true, 2800, 130); // EV

        vm.stopBroadcast();

        console.log("TricycleNFT:          ", address(nft));
        console.log("FractionalInvestment: ", address(inv));
        console.log("USDC:                 ", usdc);
    }

    function _seed(
        TricycleNFT nft,
        FractionalInvestment inv,
        address to,
        string memory vehicleId,
        string memory make,
        string memory model,
        bool isEV,
        uint256 priceUsd,
        uint256 rangeKm
    ) internal {
        uint256 id = nft.mintTricycle(to, TricycleNFT.Meta(vehicleId, make, model, isEV, priceUsd, rangeKm));
        // $1 per share → totalShares == priceUsd (asset price unchanged, shares
        // affordable: invest from $1, and the full loop is demoable with small amounts).
        inv.openPool(id, 1e6, priceUsd);
    }
}
