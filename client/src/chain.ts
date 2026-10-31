export interface ChainStatus {
  chainId: string;
  height: string;
  blockTime: string;
  syncing: boolean;
}

export interface CoinBalance {
  denom: string;
  amount: string;
}

export interface AccountTransaction {
  txhash: string;
  height: string;
  timestamp: string;
  code: number;
}

export interface Validator {
  operator_address: string;
  tokens: string;
  status: string;
  jailed: boolean;
  description?: {
    moniker?: string;
    identity?: string;
  };
  commission?: {
    commission_rates?: {
      rate?: string;
    };
  };
}

const requestTimeoutMs = 8000;

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${normalizedBaseUrl(baseUrl)}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chain API returned HTTP ${response.status} for ${path}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Chain API request timed out for ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getChainStatus(baseUrl: string): Promise<ChainStatus> {
  const [nodeInfo, latestBlock, syncing] = await Promise.all([
    getJson<{
      default_node_info?: { network?: string };
      node_info?: { network?: string };
    }>(baseUrl, "/cosmos/base/tendermint/v1beta1/node_info"),
    getJson<{
      block?: {
        header?: {
          height?: string;
          time?: string;
        };
      };
    }>(baseUrl, "/cosmos/base/tendermint/v1beta1/blocks/latest"),
    getJson<{ syncing?: boolean }>(
      baseUrl,
      "/cosmos/base/tendermint/v1beta1/syncing",
    ),
  ]);

  const header = latestBlock.block?.header;
  const chainId =
    nodeInfo.default_node_info?.network ?? nodeInfo.node_info?.network;

  if (
    !chainId ||
    !header?.height ||
    !header.time ||
    typeof syncing.syncing !== "boolean"
  ) {
    throw new Error("Chain API returned incomplete network status");
  }

  return {
    chainId,
    height: header.height,
    blockTime: header.time,
    syncing: syncing.syncing,
  };
}

export async function getValidators(baseUrl: string): Promise<Validator[]> {
  const result = await getJson<{ validators?: Validator[] }>(
    baseUrl,
    "/cosmos/staking/v1beta1/validators?pagination.limit=100",
  );
  if (!Array.isArray(result.validators)) {
    throw new Error("Chain API returned an invalid validator list");
  }
  if (
    result.validators.some(
      (validator) =>
        !validator.operator_address ||
        !/^\d+$/.test(validator.tokens) ||
        (validator.commission?.commission_rates?.rate !== undefined &&
          !/^\d+(\.\d+)?$/.test(
            validator.commission.commission_rates.rate,
          )),
    )
  ) {
    throw new Error("Chain API returned invalid validator data");
  }
  return result.validators;
}

export async function getAccountBalances(
  baseUrl: string,
  address: string,
): Promise<CoinBalance[]> {
  const result = await getJson<{ balances?: CoinBalance[] }>(
    baseUrl,
    `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}?pagination.limit=100`,
  );
  if (!Array.isArray(result.balances)) {
    throw new Error("Chain API returned an invalid account balance list");
  }
  const balances = result.balances;
  if (
    balances.some(
      (coin) =>
        !coin.denom ||
        !/^\d+$/.test(coin.amount),
    )
  ) {
    throw new Error("Chain API returned an invalid account balance");
  }
  return balances;
}

export async function getAccountTransactions(
  baseUrl: string,
  address: string,
): Promise<AccountTransaction[]> {
  const query = (event: string) =>
    `/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(event)}&pagination.limit=10&order_by=ORDER_BY_DESC`;

  const [sent, received] = await Promise.all([
    getJson<{ tx_responses?: AccountTransaction[] }>(
      baseUrl,
      query(`message.sender='${address}'`),
    ),
    getJson<{ tx_responses?: AccountTransaction[] }>(
      baseUrl,
      query(`transfer.recipient='${address}'`),
    ),
  ]);

  if (
    !Array.isArray(sent.tx_responses) ||
    !Array.isArray(received.tx_responses)
  ) {
    throw new Error("Chain API returned an invalid transaction list");
  }
  const transactions = [...sent.tx_responses, ...received.tx_responses];
  if (
    transactions.some(
      (transaction) =>
        !transaction.txhash ||
        !/^\d+$/.test(transaction.height) ||
        !Number.isInteger(transaction.code) ||
        (transaction.timestamp && Number.isNaN(Date.parse(transaction.timestamp))),
    )
  ) {
    throw new Error("Chain API returned an invalid transaction record");
  }

  return transactions
    .filter(
      (transaction, index, transactions) =>
        transactions.findIndex(
          (candidate) => candidate.txhash === transaction.txhash,
        ) === index,
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 10);
}

export function formatScoin(baseAmount: string) {
  if (!/^\d+$/.test(baseAmount)) {
    throw new Error("Chain API returned an invalid coin amount");
  }
  const amount = BigInt(baseAmount);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ""}`;
}

export function shorten(value: string, edge = 7) {
  if (value.length <= edge * 2) {
    return value;
  }
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}
