const { network, getNamedAccounts, ethers } = require("hardhat");
const { developmentChains } = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Staging Tests", function () {
        let lottery, lotteryEntranceFee, deployer

        beforeEach(async function () {
            deployer = (await getNamedAccounts()).deployer
            lottery = await ethers.getContract("Lottery", deployer)
            lotteryEntranceFee = await lottery.getEntranceFee()
        })
        describe("fulfillRandomWords", function () {
            it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
                //enter the lottery
                console.log("Setting up test...")
                const startingTimeStam = await lottery.getLastTimeStamp()
                const accounts = await ethers.getSigners()

                //setup listener before we enter the lottery
                //Just in case the blockchain moves really fast
                console.log("Setting up Listener...")
                await new Promise(async (resolve, reject) => {
                    lottery.once("WinnerPicked", async () => {
                        console.log("WinnerPicked event fired!")
                        try {
                            const recentWinner = await lottery.getRecentWinner()
                            const lotteryState = await lottery.getLotteryState()
                            const winnerEndingBalance = await accounts[0].getBalance()
                            const endingTimeStamp = await lottery.getLastTimeStamp()

                            await expect(lottery.getPlayer(0)).to.be.reverted
                            assert.equal(recentWinner.toString(), accounts[0].address)
                            assert.equal(lotteryState, 0)
                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance.add(lotteryEntranceFee).toString())
                            assert(endingTimeStamp > startingTimeStam)
                            resolve()
                        } catch (e) {
                            console.log(e)
                            reject(e)
                        }
                    })
                    //Then entering the lottery
                    console.log("Entering lottery...")
                    const tx = await lottery.enterLottery({ value: lotteryEntranceFee })
                    await tx.wait(1)
                    console.log("Ok, time to wait...")
                    const winnerStartingBalance = await accounts[0].getBalance()

                    //and this code WONT complete until our listener has finished listening!
                })

            })
        })
    })