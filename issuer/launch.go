package issuer

import (
	"errors"
	"fmt"
)

var ErrProductionDisabled = errors.New("production issuance and redemption are disabled")

func CanIssue() error {
	return fmt.Errorf("%w: production banking, custody, regulatory and on-chain integrations are not configured", ErrProductionDisabled)
}

func CanRedeem() error {
	return fmt.Errorf("%w: production banking, custody, regulatory and on-chain integrations are not configured", ErrProductionDisabled)
}
