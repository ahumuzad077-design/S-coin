package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"scoin/exchange"
)

func main() {
	addr := strings.TrimSpace(os.Getenv("MERIDIAN_DEMO_ADDR"))
	if addr == "" {
		addr = "127.0.0.1:8788"
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatal("MERIDIAN_DEMO_ADDR must bind to loopback only (127.0.0.1, localhost, or ::1); this prototype is not hardened for network exposure")
	}
	server := &http.Server{
		Addr:              addr,
		Handler:           exchange.NewHTTPHandler(exchange.NewDemoEngine()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	log.Printf("MERIDIAN DEMO EXCHANGE listening at http://%s", addr)
	log.Printf("SIMULATION ONLY: synthetic securities, paper cash and in-memory orders; do not expose to the internet")
	log.Fatal(server.ListenAndServe())
}
