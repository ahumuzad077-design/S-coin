package issuer

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrInvalidQuorum    = errors.New("treasury multisignature quorum is invalid or insufficient")
	ErrInvalidOperation = errors.New("treasury operation is invalid or expired")
)

const maxOperationLifetime = 15 * time.Minute

type TreasuryOperation struct {
	ID            string `json:"id"`
	Action        string `json:"action"`
	AssetCode     string `json:"asset_code"`
	Amount        string `json:"amount"`
	Recipient     string `json:"recipient"`
	ChainID       string `json:"chain_id"`
	ExpiresAtUnix int64  `json:"expires_at_unix"`
}

type TreasurySigner struct {
	ID        string
	PublicKey ed25519.PublicKey
	Role      string
}

type TreasuryApproval struct {
	SignerID  string
	Signature []byte
}

type MultisigPolicy struct {
	threshold uint32
	signers   map[string]TreasurySigner
}

type VerifiedTreasuryAuthorization struct {
	operationID string
	action      string
	assetCode   string
	amount      string
	recipient   string
	chainID     string
	expiresAt   int64
	digest      [sha256.Size]byte
}

func NewMultisigPolicy(threshold uint32, signers []TreasurySigner) (*MultisigPolicy, error) {
	if threshold < 2 || threshold > uint32(len(signers)) {
		return nil, ErrInvalidQuorum
	}
	index := make(map[string]TreasurySigner, len(signers))
	for _, signer := range signers {
		if signer.ID == "" || signer.Role == "" || len(signer.PublicKey) != ed25519.PublicKeySize {
			return nil, ErrInvalidQuorum
		}
		if _, exists := index[signer.ID]; exists {
			return nil, ErrInvalidQuorum
		}
		signer.PublicKey = append(ed25519.PublicKey(nil), signer.PublicKey...)
		index[signer.ID] = signer
	}
	return &MultisigPolicy{threshold: threshold, signers: index}, nil
}

func (p *MultisigPolicy) Verify(operation TreasuryOperation, approvals []TreasuryApproval, now time.Time) error {
	if p == nil || p.threshold < 2 || len(p.signers) < int(p.threshold) ||
		operation.ID == "" || operation.Action == "" || operation.ChainID == "" ||
		operation.Recipient == "" || operation.ExpiresAtUnix <= now.Unix() ||
		operation.ExpiresAtUnix > now.Add(maxOperationLifetime).Unix() {
		return ErrInvalidOperation
	}
	if !isTreasuryAction(operation.Action) {
		return ErrInvalidOperation
	}
	if _, err := AssetByCode(operation.AssetCode); err != nil {
		return err
	}
	amount, err := parseAmount(operation.Amount)
	if err != nil {
		return err
	}
	if amount.Sign() <= 0 || amount.String() != operation.Amount {
		return ErrInvalidOperation
	}

	message, err := operationMessage(operation)
	if err != nil {
		return err
	}
	approved := make(map[string]struct{}, len(approvals))
	for _, approval := range approvals {
		signer, exists := p.signers[approval.SignerID]
		if !exists || signer.Role != "treasury" || len(approval.Signature) != ed25519.SignatureSize {
			return ErrInvalidQuorum
		}
		if _, exists := approved[approval.SignerID]; exists {
			return ErrInvalidQuorum
		}
		if !ed25519.Verify(signer.PublicKey, message, approval.Signature) {
			return ErrInvalidQuorum
		}
		approved[approval.SignerID] = struct{}{}
	}
	if len(approved) < int(p.threshold) {
		return ErrInvalidQuorum
	}
	return nil
}

func (p *MultisigPolicy) Authorize(
	operation TreasuryOperation,
	approvals []TreasuryApproval,
	now time.Time,
) (VerifiedTreasuryAuthorization, error) {
	if err := p.Verify(operation, approvals, now); err != nil {
		return VerifiedTreasuryAuthorization{}, err
	}
	message, err := operationMessage(operation)
	if err != nil {
		return VerifiedTreasuryAuthorization{}, err
	}
	return VerifiedTreasuryAuthorization{
		operationID: operation.ID,
		action:      operation.Action,
		assetCode:   operation.AssetCode,
		amount:      operation.Amount,
		recipient:   operation.Recipient,
		chainID:     operation.ChainID,
		expiresAt:   operation.ExpiresAtUnix,
		digest:      sha256.Sum256(message),
	}, nil
}

func (a VerifiedTreasuryAuthorization) validFor(operation TreasuryOperation, now time.Time) bool {
	if a.operationID == "" || a.action != operation.Action ||
		a.assetCode != operation.AssetCode || a.amount != operation.Amount ||
		a.recipient != operation.Recipient || a.chainID != operation.ChainID ||
		a.expiresAt != operation.ExpiresAtUnix || a.expiresAt <= now.Unix() {
		return false
	}
	message, err := operationMessage(operation)
	return err == nil && a.digest == sha256.Sum256(message)
}

func operationMessage(operation TreasuryOperation) ([]byte, error) {
	if _, err := AssetByCode(operation.AssetCode); err != nil {
		return nil, err
	}
	amount, err := parseAmount(operation.Amount)
	if operation.ID == "" || !isTreasuryAction(operation.Action) ||
		operation.Recipient == "" || operation.ChainID == "" ||
		operation.ExpiresAtUnix <= 0 || err != nil ||
		amount.Sign() <= 0 || amount.String() != operation.Amount {
		return nil, ErrInvalidOperation
	}
	canonical := struct {
		Domain        string `json:"domain"`
		ID            string `json:"id"`
		Action        string `json:"action"`
		AssetCode     string `json:"asset_code"`
		Amount        string `json:"amount"`
		Recipient     string `json:"recipient"`
		ChainID       string `json:"chain_id"`
		ExpiresAtUnix int64  `json:"expires_at_unix"`
	}{
		Domain: "sqm-treasury-operation-v1", ID: operation.ID,
		Action: operation.Action, AssetCode: operation.AssetCode,
		Amount: operation.Amount, Recipient: operation.Recipient,
		ChainID: operation.ChainID, ExpiresAtUnix: operation.ExpiresAtUnix,
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return digest[:], nil
}

func SignOperation(privateKey ed25519.PrivateKey, operation TreasuryOperation) ([]byte, error) {
	if len(privateKey) != ed25519.PrivateKeySize || operation.ID == "" ||
		operation.Action == "" || operation.ChainID == "" || operation.Recipient == "" {
		return nil, ErrInvalidOperation
	}
	message, err := operationMessage(operation)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(privateKey, message), nil
}

func isTreasuryAction(action string) bool {
	switch action {
	case "mint", "lock", "payout", "burn", "release_lock":
		return true
	default:
		return false
	}
}
