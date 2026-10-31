package issuer

import (
	"testing"
	"time"
)

func TestAuditHashChainsEventsAndDetectsMutation(t *testing.T) {
	first := AuditEvent{
		ID: "fixture-audit-1", ActorID: "fixture-admin",
		Action: "deposit.confirmed", AssetCode: "SQM-UGX",
		ObjectType: "deposit", ObjectID: "fixture-deposit-1",
		OccurredAt: time.Unix(1_800_000_000, 0).UTC(),
	}
	firstHash, err := HashAuditEvent(first, "")
	if err != nil {
		t.Fatal(err)
	}
	second := AuditEvent{
		ID: "fixture-audit-2", ActorID: "fixture-auditor",
		Action: "reconciliation.completed", AssetCode: "SQM-UGX",
		ObjectType: "reconciliation", ObjectID: "fixture-reconciliation",
		OccurredAt: first.OccurredAt.Add(time.Second),
	}
	linkedHash, err := HashAuditEvent(second, firstHash)
	if err != nil {
		t.Fatal(err)
	}
	unlinkedHash, err := HashAuditEvent(second, "")
	if err != nil {
		t.Fatal(err)
	}
	if linkedHash == unlinkedHash {
		t.Fatal("event hash must bind the previous audit record")
	}
	tampered := second
	tampered.Action = "deposit.rejected"
	tamperedHash, err := HashAuditEvent(tampered, firstHash)
	if err != nil {
		t.Fatal(err)
	}
	if linkedHash == tamperedHash {
		t.Fatal("event hash must bind the canonical event contents")
	}
	if err := VerifyAuditChain([]ChainedAuditEvent{
		{Event: first, Hash: firstHash},
		{Event: second, PreviousHash: firstHash, Hash: linkedHash},
	}); err != nil {
		t.Fatalf("valid linked audit chain rejected: %v", err)
	}
	if err := VerifyAuditChain([]ChainedAuditEvent{
		{Event: first, Hash: firstHash},
		{Event: second, PreviousHash: firstHash, Hash: tamperedHash},
	}); err == nil {
		t.Fatal("tampered audit event must fail chain verification")
	}
}

func FuzzParseAmount(f *testing.F) {
	for _, seed := range []string{"0", "1", "99", "1234567890", "", "-1", "1.5"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, value string) {
		amount, err := parseAmount(value)
		if err == nil {
			normalized := amount.String()
			if amount.Sign() < 0 || len(normalized) > 78 {
				t.Fatalf("parser returned a noncanonical amount: %q", amount.String())
			}
			for _, digit := range normalized {
				if digit < '0' || digit > '9' {
					t.Fatalf("parser returned a non-decimal amount: %q", normalized)
				}
			}
		}
	})
}
