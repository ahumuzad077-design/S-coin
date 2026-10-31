package exchange

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type orderRequest struct {
	Symbol     string    `json:"symbol"`
	Side       OrderSide `json:"side"`
	Quantity   int64     `json:"quantity"`
	LimitPrice int64     `json:"limitPrice"`
}

func NewHTTPHandler(engine *Engine) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "mode": SimulationMode, "warning": "Synthetic securities and paper trading only"})
	})
	mux.HandleFunc("/api/v1/markets", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, engine.Summary())
	})
	mux.HandleFunc("/api/v1/securities", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mode": SimulationMode, "securities": engine.Securities()})
	})
	mux.HandleFunc("/api/v1/securities/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/securities/"), "/")
		parts := strings.Split(path, "/")
		if len(parts) == 2 && parts[1] == "orderbook" {
			book, err := engine.OrderBook(parts[0])
			if err != nil {
				writeEngineError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, book)
			return
		}
		if len(parts) == 1 && parts[0] != "" {
			security, err := engine.Security(parts[0])
			if err != nil {
				writeEngineError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"mode": SimulationMode, "security": security})
			return
		}
		http.NotFound(w, r)
	})
	mux.HandleFunc("/api/v1/account", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		portfolio, err := engine.Portfolio(DemoAccountID)
		if err != nil {
			writeEngineError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, portfolio)
	})
	mux.HandleFunc("/api/v1/orders", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{"mode": SimulationMode, "orders": engine.Orders(DemoAccountID), "fills": engine.Fills(DemoAccountID)})
		case http.MethodPost:
			var input orderRequest
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&input); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_json", "Provide a valid simulated limit-order request.")
				return
			}
			if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
				writeError(w, http.StatusBadRequest, "invalid_json", "Request body must contain one JSON object.")
				return
			}
			order, fills, err := engine.PlaceLimitOrder(DemoAccountID, input.Symbol, input.Side, input.Quantity, input.LimitPrice)
			if err != nil {
				writeEngineError(w, err)
				return
			}
			portfolio, _ := engine.Portfolio(DemoAccountID)
			writeJSON(w, http.StatusCreated, map[string]any{"mode": SimulationMode, "paperTrade": true, "order": order, "fills": fills, "portfolio": portfolio, "warning": "This is a paper-trading simulation. No real securities or money are involved."})
		default:
			methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	})
	mux.HandleFunc("/api/v1/orders/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodDelete)
			return
		}
		orderID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/orders/"), "/")
		if orderID == "" || strings.Contains(orderID, "/") {
			http.NotFound(w, r)
			return
		}
		order, err := engine.CancelOrder(DemoAccountID, orderID)
		if err != nil {
			writeEngineError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mode": SimulationMode, "order": order, "paperTrade": true})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !allowedOrigin(origin) {
				writeError(w, http.StatusForbidden, "origin_not_allowed", "This local demo API only accepts the S Coin development app origins.")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func allowedOrigin(origin string) bool {
	switch origin {
	case "http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:19006", "http://127.0.0.1:19006":
		return true
	default:
		return false
	}
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow+", OPTIONS")
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method is not supported for this endpoint.")
}

func writeEngineError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnknownSecurity), errors.Is(err, ErrUnknownOrder):
		writeError(w, http.StatusNotFound, "not_found", err.Error())
	case errors.Is(err, ErrInvalidOrder):
		writeError(w, http.StatusBadRequest, "invalid_order", err.Error())
	case errors.Is(err, ErrInsufficientCash), errors.Is(err, ErrInsufficientShares), errors.Is(err, ErrOrderNotOpen):
		writeError(w, http.StatusUnprocessableEntity, "order_rejected", err.Error())
	case errors.Is(err, ErrNotOrderOwner):
		writeError(w, http.StatusForbidden, "not_order_owner", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "The simulated market operation could not be completed.")
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}, "mode": SimulationMode})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
