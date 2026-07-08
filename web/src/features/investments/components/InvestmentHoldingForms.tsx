import { useState } from "react";
import {
  parseInteger,
  parseQuantity,
} from "@/features/investments/format";
import type {
  CreateInvestmentPositionInput,
  CreateInvestmentValuationSnapshotInput,
  InvestmentAccount,
  InvestmentAsset,
  InvestmentPosition,
} from "@/types/investments";
import { inputClassName } from "./InvestmentFormOptions";
import {
  Input,
  SmallForm,
} from "./InvestmentFormControls";

export function PositionForm({
  accounts,
  assets,
  onSubmit,
  pending,
}: {
  accounts: InvestmentAccount[];
  assets: InvestmentAsset[];
  onSubmit: (body: CreateInvestmentPositionInput) => void;
  pending: boolean;
}) {
  const [accountId, setAccountId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [notes, setNotes] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  return (
    <SmallForm
      title="보유 자산 기록"
      pending={pending}
      disabled={!assetId || !quantity || !costBasis}
      onSubmit={() => {
        onSubmit({
          accountId: accountId || undefined,
          assetId,
          quantityMicro: parseQuantity(quantity),
          costBasisAmount: parseInteger(costBasis),
          currency: selectedAsset?.currency,
          notes: notes.trim(),
        });
        setQuantity("");
        setCostBasis("");
        setNotes("");
      }}
    >
      <select
        value={accountId}
        onChange={(event) => setAccountId(event.target.value)}
        className={inputClassName}
      >
        <option value="">계좌 미지정</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <select
        value={assetId}
        onChange={(event) => setAssetId(event.target.value)}
        className={inputClassName}
      >
        <option value="">자산 선택</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} {asset.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input value={quantity} onChange={setQuantity} placeholder="수량" />
        <Input value={costBasis} onChange={setCostBasis} placeholder="기준 금액" />
      </div>
      <Input value={notes} onChange={setNotes} placeholder="메모" />
    </SmallForm>
  );
}

export function ValuationForm({
  positions,
  onSubmit,
  pending,
}: {
  positions: InvestmentPosition[];
  onSubmit: (body: CreateInvestmentValuationSnapshotInput) => void;
  pending: boolean;
}) {
  const [positionId, setPositionId] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [marketValue, setMarketValue] = useState("");
  const selectedPosition = positions.find((position) => position.id === positionId);
  return (
    <SmallForm
      title="평가 스냅샷"
      pending={pending}
      disabled={!positionId || !marketValue}
      onSubmit={() => {
        onSubmit({
          positionId,
          unitPriceAmount: unitPrice ? parseInteger(unitPrice) : undefined,
          marketValueAmount: parseInteger(marketValue),
          currency: selectedPosition?.currency,
        });
        setUnitPrice("");
        setMarketValue("");
      }}
    >
      <select
        value={positionId}
        onChange={(event) => setPositionId(event.target.value)}
        className={inputClassName}
      >
        <option value="">보유 자산 선택</option>
        {positions.map((position) => (
          <option key={position.id} value={position.id}>
            {position.assetSymbol} {position.assetName}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input value={unitPrice} onChange={setUnitPrice} placeholder="단가" />
        <Input value={marketValue} onChange={setMarketValue} placeholder="평가액" />
      </div>
    </SmallForm>
  );
}
