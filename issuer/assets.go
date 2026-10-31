package issuer

import (
	"errors"
	"fmt"
)

type Asset struct {
	Code                      string
	BaseDenom                 string
	FiatCurrency              string
	TokenDecimals             uint32
	BaseUnitsPerToken         uint64
	FiatMinorUnitsPerBaseUnit uint64
	RedemptionDescription     string
}

var assetDefinitions = [...]Asset{
	{
		Code:                      "SQM-UGX",
		BaseDenom:                 "sqmugx",
		FiatCurrency:              "UGX",
		TokenDecimals:             0,
		BaseUnitsPerToken:         1,
		FiatMinorUnitsPerBaseUnit: 1,
		RedemptionDescription:     "1 SQM-UGX (1 sqmugx base unit) redeems for UGX 1 after eligibility checks and confirmed payout.",
	},
	{
		Code:                      "SQM-USD",
		BaseDenom:                 "sqmusd",
		FiatCurrency:              "USD",
		TokenDecimals:             2,
		BaseUnitsPerToken:         100,
		FiatMinorUnitsPerBaseUnit: 1,
		RedemptionDescription:     "100 sqmusd base units (1 SQM-USD) redeem for USD 1 (100 cents) after eligibility checks and confirmed payout.",
	},
}

var ErrUnknownAsset = errors.New("unknown cash-backed asset")

func AssetByCode(code string) (Asset, error) {
	for _, asset := range assetDefinitions {
		if asset.Code == code {
			return asset, nil
		}
	}
	return Asset{}, fmt.Errorf("%w: %q", ErrUnknownAsset, code)
}

func Assets() []Asset {
	result := make([]Asset, len(assetDefinitions))
	copy(result, assetDefinitions[:])
	return result
}
