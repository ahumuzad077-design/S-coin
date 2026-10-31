package issuer

import "testing"

func TestAssetDefinitionsAreSeparateAndDoNotChangeNativeDenom(t *testing.T) {
	ugx, err := AssetByCode("SQM-UGX")
	if err != nil {
		t.Fatal(err)
	}
	usd, err := AssetByCode("SQM-USD")
	if err != nil {
		t.Fatal(err)
	}
	if ugx.BaseDenom == usd.BaseDenom || ugx.FiatCurrency == usd.FiatCurrency {
		t.Fatal("cash-backed assets must have separate denominations and fiat currencies")
	}
	if ugx.BaseDenom == "uscoin" || usd.BaseDenom == "uscoin" {
		t.Fatal("cash-backed assets must not use the native denomination")
	}
	if ugx.TokenDecimals != 0 || ugx.BaseUnitsPerToken != 1 ||
		ugx.FiatMinorUnitsPerBaseUnit != 1 {
		t.Fatalf("unexpected UGX specification: %+v", ugx)
	}
	if usd.TokenDecimals != 2 || usd.BaseUnitsPerToken != 100 ||
		usd.FiatMinorUnitsPerBaseUnit != 1 {
		t.Fatalf("unexpected USD specification: %+v", usd)
	}

	all := Assets()
	all[0].BaseDenom = "modified"
	again, err := AssetByCode("SQM-UGX")
	if err != nil {
		t.Fatal(err)
	}
	if again.BaseDenom != "sqmugx" {
		t.Fatal("asset definitions must not be mutable by callers")
	}
}

func TestCashAssetPrecisionMapsFiatMinorUnitsToChainBaseUnits(t *testing.T) {
	for _, code := range []string{"SQM-UGX", "SQM-USD"} {
		asset, err := AssetByCode(code)
		if err != nil {
			t.Fatal(err)
		}
		expectedBaseUnits := uint64(1)
		for i := uint32(0); i < asset.TokenDecimals; i++ {
			expectedBaseUnits *= 10
		}
		if asset.BaseUnitsPerToken != expectedBaseUnits ||
			asset.FiatMinorUnitsPerBaseUnit != 1 {
			t.Fatalf("%s base units must align one-to-one with its fiat minor units: %+v", code, asset)
		}
	}
}
