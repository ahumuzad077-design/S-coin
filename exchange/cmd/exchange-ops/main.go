package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"scoin/exchange"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: exchange-ops migrate|serve")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" { log.Fatal("DATABASE_URL is required") }
	store, err := exchange.OpenPostgres(ctx, databaseURL)
	if err != nil { log.Fatal(err) }
	defer store.Close()

	switch os.Args[1] {
	case "migrate":
		if err := store.RunMigrations(ctx); err != nil { log.Fatal(err) }
		log.Print("MERIDIAN exchange operations database migration completed")
	case "serve":
		serve(context.Background(), store)
	default:
		log.Fatal("unknown command; use migrate or serve")
	}
}

func serve(ctx context.Context, store *exchange.PostgresStore) {
	if err := store.CheckSchema(ctx); err != nil { log.Fatal(err) }

	issuerURL := strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL"))
	clientID := strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID"))
	legalName := strings.TrimSpace(os.Getenv("EXCHANGE_LEGAL_NAME"))
	certFile := strings.TrimSpace(os.Getenv("EXCHANGE_TLS_CERT_FILE"))
	keyFile := strings.TrimSpace(os.Getenv("EXCHANGE_TLS_KEY_FILE"))
	if issuerURL == "" || clientID == "" || legalName == "" || certFile == "" || keyFile == "" {
		log.Fatal("OIDC_ISSUER_URL, OIDC_CLIENT_ID, EXCHANGE_LEGAL_NAME, EXCHANGE_TLS_CERT_FILE and EXCHANGE_TLS_KEY_FILE are required")
	}

	authContext, authCancel := context.WithTimeout(ctx, 15*time.Second)
	defer authCancel()
	auth, err := exchange.NewOIDCAuthenticator(authContext, issuerURL, clientID)
	if err != nil { log.Fatal(err) }

	address := strings.TrimSpace(os.Getenv("EXCHANGE_LISTEN_ADDR"))
	if address == "" { address = ":8443" }
	server := &http.Server{
		Addr: address,
		Handler: exchange.NewHTTPHandler(store, auth, legalName),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 1 << 20,
		TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13},
	}
	log.Printf("MERIDIAN issuer-operations service listening with TLS on %s", address)
	if err := server.ListenAndServeTLS(certFile, keyFile); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
