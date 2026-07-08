import { useState } from "react";
import type {
  CreateInvestmentAccountInput,
  CreateInvestmentAssetInput,
} from "@/types/investments";
import {
  ASSET_TYPES,
  inputClassName,
} from "./InvestmentFormOptions";
import {
  Input,
  SmallForm,
} from "./InvestmentFormControls";

export function AccountForm({
  onSubmit,
  pending,
}: {
  onSubmit: (body: CreateInvestmentAccountInput) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [currency, setCurrency] = useState("KRW");
  return (
    <SmallForm
      title="계좌 추가"
      pending={pending}
      disabled={!name.trim()}
      onSubmit={() => {
        onSubmit({ name: name.trim(), institution: institution.trim(), currency });
        setName("");
        setInstitution("");
      }}
    >
      <Input value={name} onChange={setName} placeholder="계좌명" />
      <Input value={institution} onChange={setInstitution} placeholder="기관/위치" />
      <Input value={currency} onChange={setCurrency} placeholder="통화" />
    </SmallForm>
  );
}

export function AssetForm({
  onSubmit,
  pending,
}: {
  onSubmit: (body: CreateInvestmentAssetInput) => void;
  pending: boolean;
}) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("stock");
  const [exchange, setExchange] = useState("");
  const [currency, setCurrency] = useState("KRW");
  return (
    <SmallForm
      title="자산 추가"
      pending={pending}
      disabled={!symbol.trim()}
      onSubmit={() => {
        onSubmit({
          symbol: symbol.trim(),
          name: name.trim(),
          assetType,
          exchange: exchange.trim(),
          currency,
        });
        setSymbol("");
        setName("");
      }}
    >
      <Input value={symbol} onChange={setSymbol} placeholder="심볼" />
      <Input value={name} onChange={setName} placeholder="이름" />
      <select
        value={assetType}
        onChange={(event) => setAssetType(event.target.value)}
        className={inputClassName}
      >
        {ASSET_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input value={exchange} onChange={setExchange} placeholder="거래소/분류" />
        <Input value={currency} onChange={setCurrency} placeholder="통화" />
      </div>
    </SmallForm>
  );
}
