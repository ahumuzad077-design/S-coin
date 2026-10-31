package exchange

import "time"

const (
	DemoAccountID    = "DEMO-INVESTOR"
	DemoLiquidityID  = "DEMO-LIQUIDITY"
	SimulationMode   = "SIMULATION"
	DemoExchangeCode = "MERIDIAN-TEST"
	DefaultCurrency  = "UGX"
	MaxOrderQuantity = int64(1_000_000)
	MaxOrderPrice    = int64(1_000_000_000_000)
)

type Security struct {
	Symbol           string `json:"symbol"`
	Name             string `json:"name"`
	Sector           string `json:"sector"`
	Currency         string `json:"currency"`
	CurrencyDecimals uint32 `json:"currencyDecimals"`
	LastPrice        int64  `json:"lastPrice"`
	ReferencePrice   int64  `json:"referencePrice"`
	ChangeBps        int64  `json:"changeBps"`
	TickSize         int64  `json:"tickSize"`
	Status           string `json:"status"`
	Synthetic        bool   `json:"synthetic"`
}

type OrderSide string

const (
	Buy  OrderSide = "BUY"
	Sell OrderSide = "SELL"
)

type OrderStatus string

const (
	OrderOpen      OrderStatus = "OPEN"
	OrderPartial   OrderStatus = "PARTIALLY_FILLED"
	OrderFilled    OrderStatus = "FILLED"
	OrderCancelled OrderStatus = "CANCELLED"
)

type Order struct {
	ID                string      `json:"id"`
	AccountID         string      `json:"accountId"`
	Symbol            string      `json:"symbol"`
	Side              OrderSide   `json:"side"`
	Type              string      `json:"type"`
	Quantity          int64       `json:"quantity"`
	FilledQuantity    int64       `json:"filledQuantity"`
	RemainingQuantity int64       `json:"remainingQuantity"`
	LimitPrice        int64       `json:"limitPrice"`
	Status            OrderStatus `json:"status"`
	CreatedAt         time.Time   `json:"createdAt"`
	UpdatedAt         time.Time   `json:"updatedAt"`
}

type Fill struct {
	TradeID        string    `json:"tradeId"`
	Symbol         string    `json:"symbol"`
	Price          int64     `json:"price"`
	Quantity       int64     `json:"quantity"`
	BuyerAccount   string    `json:"buyerAccount"`
	SellerAccount  string    `json:"sellerAccount"`
	BuyOrderID     string    `json:"buyOrderId"`
	SellOrderID    string    `json:"sellOrderId"`
	ExecutedAt     time.Time `json:"executedAt"`
	SimulationOnly bool      `json:"simulationOnly"`
}

type BookLevel struct {
	Price      int64 `json:"price"`
	Quantity   int64 `json:"quantity"`
	OrderCount int   `json:"orderCount"`
}

type OrderBook struct {
	Symbol string      `json:"symbol"`
	Bids   []BookLevel `json:"bids"`
	Asks   []BookLevel `json:"asks"`
	Mode   string      `json:"mode"`
}

type Position struct {
	Symbol            string `json:"symbol"`
	Name              string `json:"name"`
	Quantity          int64  `json:"quantity"`
	ReservedQuantity  int64  `json:"reservedQuantity"`
	AvailableQuantity int64  `json:"availableQuantity"`
	LastPrice         int64  `json:"lastPrice"`
	MarketValue       int64  `json:"marketValue"`
	Currency          string `json:"currency"`
}

type Portfolio struct {
	AccountID     string     `json:"accountId"`
	Currency      string     `json:"currency"`
	CashBalance   int64      `json:"cashBalance"`
	ReservedCash  int64      `json:"reservedCash"`
	AvailableCash int64      `json:"availableCash"`
	MarketValue   int64      `json:"marketValue"`
	TotalValue    int64      `json:"totalValue"`
	Positions     []Position `json:"positions"`
	Mode          string     `json:"mode"`
}

type AccountSeed struct {
	ID        string
	Currency  string
	Cash      int64
	Positions map[string]int64
}

type MarketSummary struct {
	Code            string     `json:"code"`
	Name            string     `json:"name"`
	Region          string     `json:"region"`
	Currency        string     `json:"currency"`
	Status          string     `json:"status"`
	Mode            string     `json:"mode"`
	SecurityCount   int        `json:"securityCount"`
	Securities      []Security `json:"securities"`
	InvestorAccount string     `json:"investorAccount"`
}
