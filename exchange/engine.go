package exchange

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrUnknownSecurity    = errors.New("unknown security")
	ErrUnknownAccount     = errors.New("unknown account")
	ErrUnknownOrder       = errors.New("unknown order")
	ErrInvalidOrder       = errors.New("invalid order")
	ErrInsufficientCash   = errors.New("insufficient available cash")
	ErrInsufficientShares = errors.New("insufficient available shares")
	ErrNotOrderOwner      = errors.New("order does not belong to this account")
	ErrOrderNotOpen       = errors.New("order is not open")
)

type account struct {
	id             string
	currency       string
	cash           int64
	reservedCash   int64
	positions      map[string]int64
	reservedShares map[string]int64
}

type Engine struct {
	mu         sync.RWMutex
	securities map[string]Security
	accounts   map[string]*account
	orders     map[string]*Order
	fills      []Fill
	orderSeq   uint64
	fillSeq    uint64
}

func NewEngine(securities []Security, accounts []AccountSeed) (*Engine, error) {
	e := &Engine{
		securities: make(map[string]Security, len(securities)),
		accounts:   make(map[string]*account, len(accounts)),
		orders:     make(map[string]*Order),
		fills:      make([]Fill, 0),
	}
	for _, security := range securities {
		security.Symbol = strings.ToUpper(strings.TrimSpace(security.Symbol))
		if security.Symbol == "" || security.Name == "" || security.Currency == "" || security.LastPrice <= 0 || security.TickSize <= 0 {
			return nil, fmt.Errorf("%w: invalid security definition", ErrInvalidOrder)
		}
		if _, exists := e.securities[security.Symbol]; exists {
			return nil, fmt.Errorf("%w: duplicate symbol %s", ErrInvalidOrder, security.Symbol)
		}
		if security.ReferencePrice <= 0 {
			security.ReferencePrice = security.LastPrice
		}
		if security.Status == "" {
			security.Status = "OPEN"
		}
		if !security.Synthetic {
			return nil, fmt.Errorf("%w: this prototype only accepts explicitly synthetic demo securities", ErrInvalidOrder)
		}
		e.securities[security.Symbol] = security
	}
	for _, seed := range accounts {
		if seed.ID == "" || seed.Currency == "" || seed.Cash < 0 {
			return nil, fmt.Errorf("%w: invalid account seed", ErrInvalidOrder)
		}
		if _, exists := e.accounts[seed.ID]; exists {
			return nil, fmt.Errorf("%w: duplicate account %s", ErrInvalidOrder, seed.ID)
		}
		positions := make(map[string]int64, len(seed.Positions))
		for symbol, quantity := range seed.Positions {
			symbol = strings.ToUpper(symbol)
			security, exists := e.securities[symbol]
			if !exists || quantity < 0 || security.Currency != seed.Currency {
				return nil, fmt.Errorf("%w: invalid seeded position %s", ErrInvalidOrder, symbol)
			}
			positions[symbol] = quantity
		}
		e.accounts[seed.ID] = &account{
			id: seed.ID, currency: seed.Currency, cash: seed.Cash,
			positions: positions, reservedShares: make(map[string]int64),
		}
	}
	return e, nil
}

func NewDemoEngine() *Engine {
	securities := []Security{
		{Symbol: "DENG", Name: "Demo Energy Infrastructure Ltd", Sector: "Energy infrastructure", Currency: "UGX", CurrencyDecimals: 0, LastPrice: 125000, ReferencePrice: 123500, TickSize: 1, Status: "OPEN", Synthetic: true},
		{Symbol: "DSOL", Name: "Demo Solar Networks Ltd", Sector: "Renewable energy", Currency: "UGX", CurrencyDecimals: 0, LastPrice: 85000, ReferencePrice: 86000, TickSize: 1, Status: "OPEN", Synthetic: true},
		{Symbol: "DLOG", Name: "Demo Logistics Group Ltd", Sector: "Logistics", Currency: "UGX", CurrencyDecimals: 0, LastPrice: 62000, ReferencePrice: 61500, TickSize: 1, Status: "OPEN", Synthetic: true},
		{Symbol: "DWAT", Name: "Demo Water Systems Ltd", Sector: "Water infrastructure", Currency: "UGX", CurrencyDecimals: 0, LastPrice: 43000, ReferencePrice: 42000, TickSize: 1, Status: "OPEN", Synthetic: true},
		{Symbol: "DAGR", Name: "Demo Agro Processing Ltd", Sector: "Agro-processing", Currency: "UGX", CurrencyDecimals: 0, LastPrice: 57000, ReferencePrice: 58000, TickSize: 1, Status: "OPEN", Synthetic: true},
	}
	accounts := []AccountSeed{
		{ID: DemoAccountID, Currency: DefaultCurrency, Cash: 100_000_000, Positions: map[string]int64{"DENG": 80, "DSOL": 120, "DLOG": 150, "DWAT": 100, "DAGR": 90}},
		{ID: DemoLiquidityID, Currency: DefaultCurrency, Cash: 100_000_000_000, Positions: map[string]int64{"DENG": 1_000_000, "DSOL": 1_000_000, "DLOG": 1_000_000, "DWAT": 1_000_000, "DAGR": 1_000_000}},
	}
	e, err := NewEngine(securities, accounts)
	if err != nil {
		panic(err)
	}
	for _, security := range securities {
		spread := security.LastPrice * 150 / 10_000 // 1.5% illustrative spread.
		if spread < 1 {
			spread = 1
		}
		_ = e.seedRestingOrder(DemoLiquidityID, security.Symbol, Sell, 1_000, security.LastPrice+spread)
		_ = e.seedRestingOrder(DemoLiquidityID, security.Symbol, Buy, 1_000, security.LastPrice-spread)
	}
	return e
}

func (e *Engine) seedRestingOrder(accountID, symbol string, side OrderSide, quantity, price int64) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	acct := e.accounts[accountID]
	security, ok := e.securities[symbol]
	if acct == nil || !ok || acct.currency != security.Currency || quantity <= 0 || price <= 0 || price%security.TickSize != 0 {
		return ErrInvalidOrder
	}
	if side == Buy {
		cost, err := checkedNotional(price, quantity)
		if err != nil || acct.cash-acct.reservedCash < cost {
			return ErrInsufficientCash
		}
		acct.reservedCash += cost
	} else {
		if acct.positions[symbol]-acct.reservedShares[symbol] < quantity {
			return ErrInsufficientShares
		}
		acct.reservedShares[symbol] += quantity
	}
	e.orderSeq++
	now := time.Now().UTC()
	order := &Order{ID: fmt.Sprintf("SIM-%08d", e.orderSeq), AccountID: accountID, Symbol: security.Symbol, Side: side, Type: "LIMIT", Quantity: quantity, RemainingQuantity: quantity, LimitPrice: price, Status: OrderOpen, CreatedAt: now, UpdatedAt: now}
	e.orders[order.ID] = order
	return nil
}

func checkedNotional(price, quantity int64) (int64, error) {
	if price <= 0 || quantity <= 0 || price > math.MaxInt64/quantity {
		return 0, ErrInvalidOrder
	}
	return price * quantity, nil
}

func (e *Engine) Securities() []Security {
	e.mu.RLock()
	defer e.mu.RUnlock()
	result := make([]Security, 0, len(e.securities))
	for _, security := range e.securities {
		result = append(result, security)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Symbol < result[j].Symbol })
	return result
}

func (e *Engine) Security(symbol string) (Security, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	security, ok := e.securities[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return Security{}, ErrUnknownSecurity
	}
	return security, nil
}

func (e *Engine) Summary() MarketSummary {
	securities := e.Securities()
	return MarketSummary{Code: DemoExchangeCode, Name: "Meridian East Africa Exchange — Demo Market", Region: "East Africa", Currency: DefaultCurrency, Status: "SIMULATION_ONLY", Mode: SimulationMode, SecurityCount: len(securities), Securities: securities, InvestorAccount: DemoAccountID}
}

func (e *Engine) PlaceLimitOrder(accountID, symbol string, side OrderSide, quantity, limitPrice int64) (Order, []Fill, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	accountID = strings.TrimSpace(accountID)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	acct := e.accounts[accountID]
	if acct == nil {
		return Order{}, nil, ErrUnknownAccount
	}
	security, ok := e.securities[symbol]
	if !ok {
		return Order{}, nil, ErrUnknownSecurity
	}
	if acct.currency != security.Currency {
		return Order{}, nil, ErrInvalidOrder
	}
	if security.Status != "OPEN" || (side != Buy && side != Sell) || quantity <= 0 || quantity > MaxOrderQuantity || limitPrice <= 0 || limitPrice > MaxOrderPrice || limitPrice%security.TickSize != 0 {
		return Order{}, nil, ErrInvalidOrder
	}
	notional, err := checkedNotional(limitPrice, quantity)
	if err != nil {
		return Order{}, nil, err
	}
	if side == Buy {
		if acct.currency != security.Currency || acct.cash-acct.reservedCash < notional {
			return Order{}, nil, ErrInsufficientCash
		}
		acct.reservedCash += notional
	} else {
		available := acct.positions[symbol] - acct.reservedShares[symbol]
		if available < quantity {
			return Order{}, nil, ErrInsufficientShares
		}
		acct.reservedShares[symbol] += quantity
	}
	e.orderSeq++
	now := time.Now().UTC()
	order := &Order{ID: fmt.Sprintf("SIM-%08d", e.orderSeq), AccountID: accountID, Symbol: symbol, Side: side, Type: "LIMIT", Quantity: quantity, RemainingQuantity: quantity, LimitPrice: limitPrice, Status: OrderOpen, CreatedAt: now, UpdatedAt: now}
	e.orders[order.ID] = order
	start := len(e.fills)
	e.matchLocked(order)
	return cloneOrder(order), append([]Fill(nil), e.fills[start:]...), nil
}

func (e *Engine) matchLocked(incoming *Order) {
	for incoming.RemainingQuantity > 0 {
		var best *Order
		for _, candidate := range e.orders {
			if candidate.Symbol != incoming.Symbol || candidate.AccountID == incoming.AccountID || candidate.RemainingQuantity <= 0 || (candidate.Status != OrderOpen && candidate.Status != OrderPartial) {
				continue
			}
			crosses := (incoming.Side == Buy && candidate.Side == Sell && incoming.LimitPrice >= candidate.LimitPrice) || (incoming.Side == Sell && candidate.Side == Buy && incoming.LimitPrice <= candidate.LimitPrice)
			if !crosses {
				continue
			}
			if best == nil || betterResting(candidate, best, incoming.Side) {
				best = candidate
			}
		}
		if best == nil {
			break
		}
		quantity := incoming.RemainingQuantity
		if best.RemainingQuantity < quantity {
			quantity = best.RemainingQuantity
		}
		e.executeFillLocked(incoming, best, quantity)
	}
	updateOrderStatus(incoming)
}

func betterResting(candidate, current *Order, incomingSide OrderSide) bool {
	if incomingSide == Buy { // incoming buy selects the lowest-priced resting ask.
		if candidate.LimitPrice != current.LimitPrice {
			return candidate.LimitPrice < current.LimitPrice
		}
	} else { // incoming sell selects the highest-priced resting bid.
		if candidate.LimitPrice != current.LimitPrice {
			return candidate.LimitPrice > current.LimitPrice
		}
	}
	if !candidate.CreatedAt.Equal(current.CreatedAt) {
		return candidate.CreatedAt.Before(current.CreatedAt)
	}
	return candidate.ID < current.ID
}

func (e *Engine) executeFillLocked(incoming, resting *Order, quantity int64) {
	buyOrder, sellOrder := incoming, resting
	if incoming.Side == Sell {
		buyOrder, sellOrder = resting, incoming
	}
	buyer := e.accounts[buyOrder.AccountID]
	seller := e.accounts[sellOrder.AccountID]
	price := resting.LimitPrice
	notional, _ := checkedNotional(price, quantity)
	reserved, _ := checkedNotional(buyOrder.LimitPrice, quantity)
	buyer.reservedCash -= reserved
	buyer.cash -= notional
	seller.reservedShares[sellOrder.Symbol] -= quantity
	seller.positions[sellOrder.Symbol] -= quantity
	buyer.positions[buyOrder.Symbol] += quantity
	seller.cash += notional
	incoming.FilledQuantity += quantity
	incoming.RemainingQuantity -= quantity
	incoming.UpdatedAt = time.Now().UTC()
	resting.FilledQuantity += quantity
	resting.RemainingQuantity -= quantity
	resting.UpdatedAt = incoming.UpdatedAt
	updateOrderStatus(incoming)
	updateOrderStatus(resting)
	e.fillSeq++
	e.fills = append(e.fills, Fill{TradeID: fmt.Sprintf("TRD-%08d", e.fillSeq), Symbol: incoming.Symbol, Price: price, Quantity: quantity, BuyerAccount: buyOrder.AccountID, SellerAccount: sellOrder.AccountID, BuyOrderID: buyOrder.ID, SellOrderID: sellOrder.ID, ExecutedAt: incoming.UpdatedAt, SimulationOnly: true})
	security := e.securities[incoming.Symbol]
	security.LastPrice = price
	if security.ReferencePrice > 0 {
		security.ChangeBps = (price - security.ReferencePrice) * 10_000 / security.ReferencePrice
	}
	e.securities[incoming.Symbol] = security
}

func updateOrderStatus(order *Order) {
	switch {
	case order.RemainingQuantity == 0:
		order.Status = OrderFilled
	case order.FilledQuantity > 0:
		order.Status = OrderPartial
	default:
		order.Status = OrderOpen
	}
}

func cloneOrder(order *Order) Order {
	return *order
}

func (e *Engine) CancelOrder(accountID, orderID string) (Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	order, ok := e.orders[orderID]
	if !ok {
		return Order{}, ErrUnknownOrder
	}
	if order.AccountID != accountID {
		return Order{}, ErrNotOrderOwner
	}
	if order.RemainingQuantity <= 0 || (order.Status != OrderOpen && order.Status != OrderPartial) {
		return Order{}, ErrOrderNotOpen
	}
	acct := e.accounts[accountID]
	if order.Side == Buy {
		reserved, err := checkedNotional(order.LimitPrice, order.RemainingQuantity)
		if err != nil || acct.reservedCash < reserved {
			return Order{}, ErrInvalidOrder
		}
		acct.reservedCash -= reserved
	} else {
		if acct.reservedShares[order.Symbol] < order.RemainingQuantity {
			return Order{}, ErrInvalidOrder
		}
		acct.reservedShares[order.Symbol] -= order.RemainingQuantity
	}
	order.Status = OrderCancelled
	order.UpdatedAt = time.Now().UTC()
	return cloneOrder(order), nil
}

func (e *Engine) OrderBook(symbol string) (OrderBook, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if _, ok := e.securities[symbol]; !ok {
		return OrderBook{}, ErrUnknownSecurity
	}
	bids := map[int64]*BookLevel{}
	asks := map[int64]*BookLevel{}
	for _, order := range e.orders {
		if order.Symbol != symbol || order.RemainingQuantity <= 0 || (order.Status != OrderOpen && order.Status != OrderPartial) {
			continue
		}
		levels := bids
		if order.Side == Sell {
			levels = asks
		}
		level := levels[order.LimitPrice]
		if level == nil {
			level = &BookLevel{Price: order.LimitPrice}
			levels[order.LimitPrice] = level
		}
		level.Quantity += order.RemainingQuantity
		level.OrderCount++
	}
	book := OrderBook{Symbol: symbol, Bids: make([]BookLevel, 0, len(bids)), Asks: make([]BookLevel, 0, len(asks)), Mode: SimulationMode}
	for _, level := range bids {
		book.Bids = append(book.Bids, *level)
	}
	for _, level := range asks {
		book.Asks = append(book.Asks, *level)
	}
	sort.Slice(book.Bids, func(i, j int) bool { return book.Bids[i].Price > book.Bids[j].Price })
	sort.Slice(book.Asks, func(i, j int) bool { return book.Asks[i].Price < book.Asks[j].Price })
	return book, nil
}

func (e *Engine) Portfolio(accountID string) (Portfolio, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	acct := e.accounts[accountID]
	if acct == nil {
		return Portfolio{}, ErrUnknownAccount
	}
	portfolio := Portfolio{AccountID: accountID, Currency: acct.currency, CashBalance: acct.cash, ReservedCash: acct.reservedCash, AvailableCash: acct.cash - acct.reservedCash, Mode: SimulationMode, Positions: make([]Position, 0)}
	for symbol, quantity := range acct.positions {
		security := e.securities[symbol]
		value, err := checkedNotional(security.LastPrice, quantity)
		if err != nil {
			return Portfolio{}, err
		}
		if portfolio.MarketValue > math.MaxInt64-value {
			return Portfolio{}, ErrInvalidOrder
		}
		portfolio.MarketValue += value
		reserved := acct.reservedShares[symbol]
		portfolio.Positions = append(portfolio.Positions, Position{Symbol: symbol, Name: security.Name, Quantity: quantity, ReservedQuantity: reserved, AvailableQuantity: quantity - reserved, LastPrice: security.LastPrice, MarketValue: value, Currency: security.Currency})
	}
	sort.Slice(portfolio.Positions, func(i, j int) bool { return portfolio.Positions[i].Symbol < portfolio.Positions[j].Symbol })
	if portfolio.CashBalance > math.MaxInt64-portfolio.MarketValue {
		return Portfolio{}, ErrInvalidOrder
	}
	portfolio.TotalValue = portfolio.CashBalance + portfolio.MarketValue
	return portfolio, nil
}

func (e *Engine) Orders(accountID string) []Order {
	e.mu.RLock()
	defer e.mu.RUnlock()
	result := make([]Order, 0)
	for _, order := range e.orders {
		if order.AccountID == accountID {
			result = append(result, cloneOrder(order))
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ID > result[j].ID
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	if len(result) > 50 {
		result = result[:50]
	}
	return result
}

func (e *Engine) Fills(accountID string) []Fill {
	e.mu.RLock()
	defer e.mu.RUnlock()
	result := make([]Fill, 0)
	for _, fill := range e.fills {
		if fill.BuyerAccount == accountID || fill.SellerAccount == accountID {
			result = append(result, fill)
		}
	}
	if len(result) > 50 {
		result = result[len(result)-50:]
	}
	return result
}
