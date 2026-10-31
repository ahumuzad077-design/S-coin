import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeTransferPreview,
  createErc20TransferPreview,
  getEvmTransactionReceipt,
  parseNativeAmountToHex,
  submitErc20Transfer,
  submitNativeTransfer,
} from "./evmTransactions.ts";

const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";
const txHash = "0x" + "a".repeat(64);
const chainId = "0xaa36a7";

class MockWallet {
  constructor(overrides = {}) {
    this.chainId = overrides.chainId ?? chainId;
    this.accounts = overrides.accounts ?? [from];
    this.balance = overrides.balance ?? "0x3635c9adc5dea00000";
    this.gasLimit = overrides.gasLimit ?? "0x5208";
    this.gasPrice = overrides.gasPrice ?? "0x3b9aca00";
    this.receipt = overrides.receipt ?? null;
    this.tokenDecimals = overrides.tokenDecimals ?? 18;
    this.tokenBalance = overrides.tokenBalance ?? 5n * 10n ** 18n;
    this.contractCode = overrides.contractCode ?? "0x60006000";
    this.sent = [];
  }

  async request({ method, params = [] }) {
    switch (method) {
      case "eth_chainId":
        return this.chainId;
      case "eth_accounts":
        return this.accounts;
      case "eth_getBalance":
        return this.balance;
      case "eth_estimateGas":
        return this.gasLimit;
      case "eth_gasPrice":
        return this.gasPrice;
      case "eth_getCode":
        return this.contractCode;
      case "eth_call": {
        const data = params[0]?.data;
        if (data === "0x313ce567") {
          return "0x" + BigInt(this.tokenDecimals).toString(16).padStart(64, "0");
        }
        if (typeof data === "string" && data.startsWith("0x70a08231")) {
          return "0x" + this.tokenBalance.toString(16).padStart(64, "0");
        }
        throw new Error("Unexpected eth_call data: " + data);
      }
      case "eth_sendTransaction":
        this.sent.push(params[0]);
        return txHash;
      case "eth_getTransactionReceipt":
        return this.receipt;
      default:
        throw new Error("Unexpected RPC method: " + method);
    }
  }
}

test("parses native coin amounts exactly to wei", () => {
  assert.equal(parseNativeAmountToHex("1"), "0xde0b6b3a7640000");
  assert.equal(parseNativeAmountToHex("0.1"), "0x16345785d8a0000");
  assert.equal(parseNativeAmountToHex("0.000000000000000001"), "0x1");
});

test("rejects zero, malformed and over-precision amounts", () => {
  for (const amount of ["0", "-1", "1e-3", "1.0000000000000000001", "01", ""]) {
    assert.throws(() => parseNativeAmountToHex(amount));
  }
});

test("prepares an EVM transfer preview and estimates the network fee", async () => {
  const wallet = new MockWallet();
  const preview = await createNativeTransferPreview(wallet, {
    chainId,
    from,
    to,
    amount: "0.25",
  });
  assert.equal(preview.valueHex, "0x3782dace9d90000");
  assert.equal(preview.gasLimitHex, "0x5208");
  assert.equal(preview.estimatedGasFee, "0.000021");
  assert.equal(preview.totalRequired, "0.250021");
});

test("rejects a changed network or disconnected account", async () => {
  await assert.rejects(
    createNativeTransferPreview(new MockWallet({ chainId: "0x1" }), {
      chainId,
      from,
      to,
      amount: "0.1",
    }),
    /network changed/,
  );

  await assert.rejects(
    createNativeTransferPreview(new MockWallet({ accounts: [] }), {
      chainId,
      from,
      to,
      amount: "0.1",
    }),
    /no longer connected/,
  );
});

test("rejects insufficient native balance before opening the wallet prompt", async () => {
  const wallet = new MockWallet({ balance: "0x1" });
  await assert.rejects(
    createNativeTransferPreview(wallet, {
      chainId,
      from,
      to,
      amount: "0.1",
    }),
    /Insufficient native balance/,
  );
  assert.equal(wallet.sent.length, 0);
});

test("submits only through the connected wallet provider", async () => {
  const wallet = new MockWallet();
  const preview = await createNativeTransferPreview(wallet, {
    chainId,
    from,
    to,
    amount: "0.1",
  });
  const hash = await submitNativeTransfer(wallet, preview);
  assert.equal(hash, txHash);
  assert.equal(wallet.sent.length, 1);
  assert.equal(wallet.sent[0].from, from);
  assert.equal(wallet.sent[0].to, to);
  assert.equal(wallet.sent[0].value, parseNativeAmountToHex("0.1"));
});

test("parses mined transaction receipts and leaves pending receipts null", async () => {
  const wallet = new MockWallet();
  assert.equal(await getEvmTransactionReceipt(wallet, chainId, txHash), null);

  wallet.receipt = {
    transactionHash: txHash,
    status: "0x1",
    blockNumber: "0x2a",
  };
  const receipt = await getEvmTransactionReceipt(wallet, chainId, txHash);
  assert.equal(receipt?.status, "success");
  assert.equal(receipt?.blockNumber, "0x2a");
});


const token = "0x3333333333333333333333333333333333333333";

test("prepares an ERC-20 transfer from contract metadata and balance", async () => {
  const wallet = new MockWallet({ gasLimit: "0x186a0" });
  const preview = await createErc20TransferPreview(wallet, {
    chainId,
    from,
    to,
    tokenAddress: token,
    amount: "1.25",
  });
  assert.equal(preview.decimals, 18);
  assert.equal(preview.amountBaseUnits, "1250000000000000000");
  assert.equal(preview.estimatedGasFee, "0.0001");
});

test("rejects an ERC-20 transfer when the contract has no code", async () => {
  await assert.rejects(
    createErc20TransferPreview(new MockWallet({ contractCode: "0x" }), {
      chainId,
      from,
      to,
      tokenAddress: token,
      amount: "1",
    }),
    /does not contain a deployed contract/,
  );
});

test("rejects an ERC-20 transfer exceeding the connected account token balance", async () => {
  await assert.rejects(
    createErc20TransferPreview(new MockWallet({ tokenBalance: 1n }), {
      chainId,
      from,
      to,
      tokenAddress: token,
      amount: "1",
    }),
    /Insufficient token balance/,
  );
});

test("submits ERC-20 transfers only through the external wallet", async () => {
  const wallet = new MockWallet({ gasLimit: "0x186a0" });
  const preview = await createErc20TransferPreview(wallet, {
    chainId,
    from,
    to,
    tokenAddress: token,
    amount: "1.25",
  });
  const hash = await submitErc20Transfer(wallet, preview);
  assert.equal(hash, txHash);
  assert.equal(wallet.sent.length, 1);
  assert.equal(wallet.sent[0].to, token);
  assert.equal(wallet.sent[0].value, "0x0");
  assert.match(wallet.sent[0].data, /^0xa9059cbb/);
});
