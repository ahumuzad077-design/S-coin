package exchange

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPExposesSimulationAndPaperOrders(t *testing.T) {
	handler := NewHTTPHandler(NewDemoEngine())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/securities", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("securities status = %d", response.Code)
	}
	var payload struct {
		Mode       string     `json:"mode"`
		Securities []Security `json:"securities"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Mode != SimulationMode || len(payload.Securities) != 5 {
		t.Fatalf("unexpected securities response: %+v", payload)
	}
	requestBody := []byte(`{"symbol":"DENG","side":"BUY","quantity":2,"limitPrice":130000}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("order status = %d: %s", response.Code, response.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["paperTrade"] != true || result["mode"] != SimulationMode {
		t.Fatalf("order response did not mark paper-trade mode: %+v", result)
	}
}

func TestHTTPRejectsNonLocalOrigin(t *testing.T) {
	handler := NewHTTPHandler(NewDemoEngine())
	request := httptest.NewRequest(http.MethodGet, "/api/v1/securities", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected origin rejection, got %d", response.Code)
	}
}

func TestHTTPRejectsUnknownJSONFields(t *testing.T) {
	handler := NewHTTPHandler(NewDemoEngine())
	request := httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewBufferString(`{"symbol":"DENG","side":"BUY","quantity":1,"limitPrice":130000,"walletAddress":"scoin1secret"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected malformed request rejection, got %d", response.Code)
	}
}
