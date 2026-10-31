package exchange

import (
	"errors"
	"testing"
)

func testEngine(t *testing.T) *Engine {
	t.Helper()
	e, err := NewEngine(
		[]Security{{Symbol: "TEST", Name: "Synthetic Test Issuer", Currency: "UGX", LastPrice: 100, ReferencePrice: 100, TickSize: 1, Status: "OPEN", Synthetic: true}},
		[]AccountSeed{
			{ID: "buyer", Currency: "UGX", Cash: 1_000_000, Positions: map[string]int64{}},
			{ID: "seller-a", Currency: "UGX", Cash: 0, Positions: map[string]int64{"TEST": 20}},
			{ID: "seller-b", Currency: "UGX", Cash: 0, Positions: map[string]int64{"TEST": 20}},
			{ID: "other", Currency: "UGX", Cash: 1_000_000, Positions: map[string]int64{"TEST": 20}},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestPricePrioritySelectsBestAsk(t *testing.T) {
	e := testEngine(t)
	if _, _, err := e.PlaceLimitOrder("seller-a", "TEST", Sell, 5, 101); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.PlaceLimitOrder("seller-b", "TEST", Sell, 5, 99); err != nil {
		t.Fatal(err)
	}
	order, fills, err := e.PlaceLimitOrder("buyer", "TEST", Buy, 5, 102)
	if err != nil {
		t.Fatal(err)
	}
	if order.Status != OrderFilled || len(fills) != 1 {
		t.Fatalf("expected one complete fill, got order=%+v fills=%+v", order, fills)
	}
	if fills[0].SellerAccount != "seller-b" || fills[0].Price != 99 {
		t.Fatalf("expected best ask 99 from seller-b, got %+v", fills[0])
	}
}

func TestTimePriorityAtSamePrice(t *testing.T) {
	e := testEngine(t)
	_, _, err := e.PlaceLimitOrder("seller-a", "TEST", Sell, 5, 100)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = e.PlaceLimitOrder("seller-b", "TEST", Sell, 5, 100)
	if err != nil {
		t.Fatal(err)
	}
	_, fills, err := e.PlaceLimitOrder("buyer", "TEST", Buy, 7, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(fills) != 2 || fills[0].SellerAccount != "seller-a" || fills[0].Quantity != 5 || fills[1].SellerAccount != "seller-b" || fills[1].Quantity != 2 {
		t.Fatalf("expected FIFO fills of 5 then 2, got %+v", fills)
	}
}

func TestBuyUpdatesCashAndPosition(t *testing.T) {
	e := testEngine(t)
	_, _, err := e.PlaceLimitOrder("seller-a", "TEST", Sell, 4, 100)
	if err != nil {
		t.Fatal(err)
	}
	_, fills, err := e.PlaceLimitOrder("buyer", "TEST", Buy, 4, 105)
	if err != nil {
		t.Fatal(err)
	}
	if len(fills) != 1 || fills[0].Price != 100 {
		t.Fatalf("unexpected fills: %+v", fills)
	}
	portfolio, err := e.Portfolio("buyer")
	if err != nil {
		t.Fatal(err)
	}
	if portfolio.CashBalance != 999_600 || len(portfolio.Positions) != 1 || portfolio.Positions[0].Quantity != 4 {
		t.Fatalf("unexpected buyer portfolio: %+v", portfolio)
	}
	if portfolio.ReservedCash != 0 {
		t.Fatalf("filled order should release price improvement reservation: %+v", portfolio)
	}
}

func TestOpenBuyReservesCashAndCancelReleasesIt(t *testing.T) {
	e := testEngine(t)
	order, _, err := e.PlaceLimitOrder("buyer", "TEST", Buy, 10, 100)
	if err != nil {
		t.Fatal(err)
	}
	portfolio, _ := e.Portfolio("buyer")
	if portfolio.ReservedCash != 1_000 || portfolio.AvailableCash != 999_000 {
		t.Fatalf("buy reservation not recorded: %+v", portfolio)
	}
	if _, err := e.CancelOrder("buyer", order.ID); err != nil {
		t.Fatal(err)
	}
	portfolio, _ = e.Portfolio("buyer")
	if portfolio.ReservedCash != 0 || portfolio.AvailableCash != 1_000_000 {
		t.Fatalf("cancel did not release reservation: %+v", portfolio)
	}
}

func TestInsufficientFundsAndSharesAreRejected(t *testing.T) {
	e := testEngine(t)
	if _, _, err := e.PlaceLimitOrder("buyer", "TEST", Buy, 10_001, 100); !errors.Is(err, ErrInsufficientCash) {
		t.Fatalf("expected insufficient cash, got %v", err)
	}
	if _, _, err := e.PlaceLimitOrder("seller-a", "TEST", Sell, 100, 100); !errors.Is(err, ErrInsufficientShares) {
		t.Fatalf("expected insufficient shares, got %v", err)
	}
}

func TestSelfTradeDoesNotMatch(t *testing.T) {
	e := testEngine(t)
	_, _, err := e.PlaceLimitOrder("other", "TEST", Buy, 5, 100)
	if err != nil {
		t.Fatal(err)
	}
	order, fills, err := e.PlaceLimitOrder("other", "TEST", Sell, 5, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(fills) != 0 || order.RemainingQuantity != 5 {
		t.Fatalf("self trade should not execute: order=%+v fills=%+v", order, fills)
	}
}

func TestCancelledOrderCannotBeCancelledAgain(t *testing.T) {
	e := testEngine(t)
	order, _, err := e.PlaceLimitOrder("buyer", "TEST", Buy, 2, 90)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.CancelOrder("buyer", order.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CancelOrder("buyer", order.ID); !errors.Is(err, ErrOrderNotOpen) {
		t.Fatalf("expected closed-order rejection, got %v", err)
	}
}
