package issuer

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"strconv"
	"time"
)

var (
	ErrWebhookNotConfigured = errors.New("bank webhook verification is not configured")
	ErrInvalidWebhook       = errors.New("bank webhook signature or timestamp is invalid")
)

type WebhookVerifier interface {
	Verify(eventID, timestamp string, body []byte, signature string, now time.Time) error
}

type VerifiedDeposit struct {
	eventID          string
	transactionRef   string
	assetCode        string
	amountMinorUnits string
	payloadSHA256    [sha256.Size]byte
	confirmedAt      time.Time
}

func (d VerifiedDeposit) Validate() error {
	if d.eventID == "" || d.transactionRef == "" || d.confirmedAt.IsZero() {
		return ErrInvalidWebhook
	}
	if _, err := AssetByCode(d.assetCode); err != nil {
		return err
	}
	amount, err := parseAmount(d.amountMinorUnits)
	if err != nil || amount.Sign() <= 0 {
		return ErrInvalidWebhook
	}
	if d.payloadSHA256 == ([sha256.Size]byte{}) {
		return ErrInvalidWebhook
	}
	return nil
}

type VerifiedPayout struct {
	eventID          string
	transactionRef   string
	assetCode        string
	amountMinorUnits string
	payloadSHA256    [sha256.Size]byte
	confirmedAt      time.Time
}

func (d VerifiedPayout) Validate() error {
	if d.eventID == "" || d.transactionRef == "" || d.confirmedAt.IsZero() {
		return ErrInvalidWebhook
	}
	if _, err := AssetByCode(d.assetCode); err != nil {
		return err
	}
	amount, err := parseAmount(d.amountMinorUnits)
	if err != nil || amount.Sign() <= 0 {
		return ErrInvalidWebhook
	}
	if d.payloadSHA256 == ([sha256.Size]byte{}) {
		return ErrInvalidWebhook
	}
	return nil
}

func (d VerifiedDeposit) EventID() string          { return d.eventID }
func (d VerifiedDeposit) TransactionRef() string   { return d.transactionRef }
func (d VerifiedDeposit) AssetCode() string        { return d.assetCode }
func (d VerifiedDeposit) AmountMinorUnits() string { return d.amountMinorUnits }
func (d VerifiedDeposit) PayloadSHA256() [sha256.Size]byte {
	return d.payloadSHA256
}
func (d VerifiedDeposit) ConfirmedAt() time.Time { return d.confirmedAt }

func (d VerifiedPayout) EventID() string          { return d.eventID }
func (d VerifiedPayout) TransactionRef() string   { return d.transactionRef }
func (d VerifiedPayout) AssetCode() string        { return d.assetCode }
func (d VerifiedPayout) AmountMinorUnits() string { return d.amountMinorUnits }
func (d VerifiedPayout) PayloadSHA256() [sha256.Size]byte {
	return d.payloadSHA256
}
func (d VerifiedPayout) ConfirmedAt() time.Time { return d.confirmedAt }

func (d VerifiedDeposit) BaseTokenUnits() (string, error) {
	asset, err := AssetByCode(d.assetCode)
	if err != nil {
		return "", err
	}
	amount, err := parseAmount(d.amountMinorUnits)
	if err != nil {
		return "", err
	}
	perBaseUnit := new(big.Int).SetUint64(asset.FiatMinorUnitsPerBaseUnit)
	tokens, remainder := new(big.Int).QuoRem(amount, perBaseUnit, new(big.Int))
	if remainder.Sign() != 0 {
		return "", ErrInvalidAmount
	}
	return tokens.String(), nil
}

func (d VerifiedDeposit) WholeTokenUnits() (string, string, error) {
	asset, err := AssetByCode(d.assetCode)
	if err != nil {
		return "", "", err
	}
	baseUnitsText, err := d.BaseTokenUnits()
	if err != nil {
		return "", "", err
	}
	baseUnits, err := parseAmount(baseUnitsText)
	if err != nil {
		return "", "", err
	}
	perToken := new(big.Int).SetUint64(asset.BaseUnitsPerToken)
	tokens, remainder := new(big.Int).QuoRem(baseUnits, perToken, new(big.Int))
	return tokens.String(), remainder.String(), nil
}

type bankWebhookPayload struct {
	EventType            string `json:"event_type"`
	TransactionReference string `json:"transaction_reference"`
	Currency             string `json:"currency"`
	AmountMinorUnits     string `json:"amount_minor_units"`
	Status               string `json:"status"`
}

// VerifyDepositWebhook accepts only cryptographically verified, cleared bank
// events. Event and transaction-reference uniqueness must also be enforced by
// the persistent ledger before recording a deposit.
func VerifyDepositWebhook(
	verifier WebhookVerifier,
	eventID, timestamp, signature string,
	body []byte,
	now time.Time,
) (VerifiedDeposit, error) {
	if verifier == nil {
		return VerifiedDeposit{}, ErrWebhookNotConfigured
	}
	if err := verifier.Verify(eventID, timestamp, body, signature, now); err != nil {
		return VerifiedDeposit{}, err
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var payload bankWebhookPayload
	if err := decoder.Decode(&payload); err != nil {
		return VerifiedDeposit{}, fmt.Errorf("%w: invalid payload", ErrInvalidWebhook)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return VerifiedDeposit{}, fmt.Errorf("%w: trailing payload data", ErrInvalidWebhook)
	}
	if payload.EventType != "deposit" || payload.Status != "cleared" || payload.TransactionReference == "" {
		return VerifiedDeposit{}, fmt.Errorf("%w: bank has not confirmed cleared funds", ErrInvalidWebhook)
	}
	amount, err := parseAmount(payload.AmountMinorUnits)
	if err != nil || amount.Sign() <= 0 {
		return VerifiedDeposit{}, fmt.Errorf("%w: invalid deposit amount", ErrInvalidWebhook)
	}

	assetCode, err := assetCodeForCurrency(payload.Currency)
	if err != nil {
		return VerifiedDeposit{}, err
	}
	unixTime, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return VerifiedDeposit{}, ErrInvalidWebhook
	}
	return VerifiedDeposit{
		eventID:          eventID,
		transactionRef:   payload.TransactionReference,
		assetCode:        assetCode,
		amountMinorUnits: amount.String(),
		payloadSHA256:    sha256.Sum256(body),
		confirmedAt:      time.Unix(unixTime, 0).UTC(),
	}, nil
}

func assetCodeForCurrency(currency string) (string, error) {
	switch currency {
	case "UGX":
		return "SQM-UGX", nil
	case "USD":
		return "SQM-USD", nil
	default:
		return "", fmt.Errorf("%w: unsupported currency", ErrInvalidWebhook)
	}
}

func VerifyPayoutWebhook(
	verifier WebhookVerifier,
	eventID, timestamp, signature string,
	body []byte,
	now time.Time,
) (VerifiedPayout, error) {
	if verifier == nil {
		return VerifiedPayout{}, ErrWebhookNotConfigured
	}
	if err := verifier.Verify(eventID, timestamp, body, signature, now); err != nil {
		return VerifiedPayout{}, err
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var payload bankWebhookPayload
	if err := decoder.Decode(&payload); err != nil {
		return VerifiedPayout{}, fmt.Errorf("%w: invalid payload", ErrInvalidWebhook)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return VerifiedPayout{}, fmt.Errorf("%w: trailing payload data", ErrInvalidWebhook)
	}
	if payload.EventType != "payout" || payload.Status != "settled" || payload.TransactionReference == "" {
		return VerifiedPayout{}, fmt.Errorf("%w: bank has not confirmed settled payout", ErrInvalidWebhook)
	}
	amount, err := parseAmount(payload.AmountMinorUnits)
	if err != nil || amount.Sign() <= 0 {
		return VerifiedPayout{}, fmt.Errorf("%w: invalid payout amount", ErrInvalidWebhook)
	}
	assetCode, err := assetCodeForCurrency(payload.Currency)
	if err != nil {
		return VerifiedPayout{}, err
	}
	unixTime, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return VerifiedPayout{}, ErrInvalidWebhook
	}
	return VerifiedPayout{
		eventID:          eventID,
		transactionRef:   payload.TransactionReference,
		assetCode:        assetCode,
		amountMinorUnits: amount.String(),
		payloadSHA256:    sha256.Sum256(body),
		confirmedAt:      time.Unix(unixTime, 0).UTC(),
	}, nil
}

// HMACWebhookVerifier implements a provider-neutral HMAC-SHA256 signature
// scheme. It is not a bank integration; use only if an approved partner
// explicitly documents this exact signing format.
type HMACWebhookVerifier struct {
	secret  []byte
	maxSkew time.Duration
}

func NewHMACWebhookVerifier(secret []byte, maxSkew time.Duration) (*HMACWebhookVerifier, error) {
	if len(secret) < 32 || maxSkew <= 0 {
		return nil, ErrWebhookNotConfigured
	}
	copied := append([]byte(nil), secret...)
	return &HMACWebhookVerifier{secret: copied, maxSkew: maxSkew}, nil
}

func (v *HMACWebhookVerifier) Verify(eventID, timestamp string, body []byte, signature string, now time.Time) error {
	if v == nil || len(v.secret) < 32 {
		return ErrWebhookNotConfigured
	}
	if eventID == "" || timestamp == "" || len(body) == 0 {
		return ErrInvalidWebhook
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return ErrInvalidWebhook
	}
	eventTime := time.Unix(seconds, 0)
	if delta := now.Sub(eventTime); delta > v.maxSkew || delta < -v.maxSkew {
		return ErrInvalidWebhook
	}
	provided, err := hex.DecodeString(signature)
	if err != nil || len(provided) != sha256.Size {
		return ErrInvalidWebhook
	}
	mac := hmac.New(sha256.New, v.secret)
	_, _ = fmt.Fprintf(mac, "%s.%s.", timestamp, eventID)
	_, _ = mac.Write(body)
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return ErrInvalidWebhook
	}
	return nil
}
