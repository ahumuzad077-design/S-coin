package issuer

import (
	"context"
	"time"
)

type BankTransaction struct {
	PartnerID          string
	AccountID          string
	TransactionRef     string
	EventType          string
	AssetCode          string
	AmountMinorUnits   string
	Status             string
	EvidenceSHA256     string
	ProviderOccurredAt time.Time
}

type BankAccountBalance struct {
	PartnerID         string
	AccountID         string
	AssetCode         string
	BalanceMinorUnits string
	EvidenceSHA256    string
	ObservedAt        time.Time
}

type BankPayoutRequest struct {
	OperationID          string
	PartnerID            string
	AccountID            string
	AssetCode            string
	AmountMinorUnits     string
	BeneficiaryRefSHA256 string
	IdempotencyKey       string
}

type BankPayoutSubmission struct {
	PartnerID        string
	TransactionRef   string
	AssetCode        string
	AmountMinorUnits string
	Status           string
	EvidenceSHA256   string
	SubmittedAt      time.Time
}

type BankingAdapter interface {
	FetchTransaction(context.Context, string, string) (BankTransaction, error)
	FetchAccountBalance(context.Context, string, string) (BankAccountBalance, error)
	SubmitPayout(context.Context, BankPayoutRequest) (BankPayoutSubmission, error)
	FetchPayout(context.Context, string, string) (BankTransaction, error)
}

type CustodyAttestation struct {
	PartnerID          string
	AssetCode          string
	EligibleMinorUnits string
	EvidenceSHA256     string
	ObservedAt         time.Time
}

type CustodyAdapter interface {
	VerifyEligibleReserve(context.Context, string, string) (CustodyAttestation, error)
}
