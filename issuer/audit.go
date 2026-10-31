package issuer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

var ErrInvalidAuditEvent = errors.New("audit event is incomplete or invalid")

type AuditEvent struct {
	ID             string
	ActorID        string
	Action         string
	AssetCode      string
	ObjectType     string
	ObjectID       string
	EvidenceSHA256 string
	OccurredAt     time.Time
}

type ChainedAuditEvent struct {
	Event        AuditEvent
	PreviousHash string
	Hash         string
}

func HashAuditEvent(event AuditEvent, previousHash string) (string, error) {
	if event.ID == "" || event.ActorID == "" || event.Action == "" ||
		event.ObjectType == "" || event.ObjectID == "" || event.OccurredAt.IsZero() {
		return "", ErrInvalidAuditEvent
	}
	if event.AssetCode != "" {
		if _, err := AssetByCode(event.AssetCode); err != nil {
			return "", err
		}
	}
	if previousHash != "" {
		if _, err := parseHash(previousHash); err != nil {
			return "", err
		}
	}
	if event.EvidenceSHA256 != "" {
		if _, err := parseHash(event.EvidenceSHA256); err != nil {
			return "", err
		}
	}
	canonical := struct {
		Domain         string `json:"domain"`
		ID             string `json:"id"`
		ActorID        string `json:"actor_id"`
		Action         string `json:"action"`
		AssetCode      string `json:"asset_code"`
		ObjectType     string `json:"object_type"`
		ObjectID       string `json:"object_id"`
		EvidenceSHA256 string `json:"evidence_sha256"`
		PreviousHash   string `json:"previous_hash"`
		OccurredAt     string `json:"occurred_at"`
	}{
		Domain: "sqm-issuer-audit-v1", ID: event.ID, ActorID: event.ActorID,
		Action: event.Action, AssetCode: event.AssetCode, ObjectType: event.ObjectType,
		ObjectID: event.ObjectID, EvidenceSHA256: event.EvidenceSHA256,
		PreviousHash: previousHash, OccurredAt: event.OccurredAt.UTC().Format(time.RFC3339Nano),
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

func VerifyAuditChain(events []ChainedAuditEvent) error {
	previousHash := ""
	seen := make(map[string]struct{}, len(events))
	for _, record := range events {
		if _, exists := seen[record.Event.ID]; exists {
			return ErrInvalidAuditEvent
		}
		if record.PreviousHash != previousHash {
			return ErrInvalidAuditEvent
		}
		expected, err := HashAuditEvent(record.Event, previousHash)
		if err != nil {
			return err
		}
		if record.Hash != expected {
			return ErrInvalidAuditEvent
		}
		seen[record.Event.ID] = struct{}{}
		previousHash = record.Hash
	}
	return nil
}

func parseHash(value string) ([]byte, error) {
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return nil, ErrInvalidAuditEvent
	}
	return decoded, nil
}
