import { useState } from "react";
import { parseInteger } from "@/features/investments/format";
import type {
  CreateInvestmentCashflowInput,
  CreateInvestmentWatchlistInput,
  InvestmentAccount,
  InvestmentAsset,
} from "@/types/investments";
import {
  CASHFLOW_TYPES,
  inputClassName,
} from "./InvestmentFormOptions";
import {
  Input,
  SmallForm,
} from "./InvestmentFormControls";

export function CashflowForm({
  accounts,
  assets,
  onSubmit,
  pending,
}: {
  accounts: InvestmentAccount[];
  assets: InvestmentAsset[];
  onSubmit: (body: CreateInvestmentCashflowInput) => void;
  pending: boolean;
}) {
  const [accountId, setAccountId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [flowType, setFlowType] = useState("dividend");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  return (
    <SmallForm
      title="현금흐름 기록"
      pending={pending}
      disabled={!amount}
      onSubmit={() => {
        onSubmit({
          accountId: accountId || undefined,
          assetId: assetId || undefined,
          flowType,
          amount: parseInteger(amount),
          currency: selectedAsset?.currency,
          notes: notes.trim(),
        });
        setAmount("");
        setNotes("");
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <select
          value={flowType}
          onChange={(event) => setFlowType(event.target.value)}
          className={inputClassName}
        >
          {CASHFLOW_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Input value={amount} onChange={setAmount} placeholder="금액" />
      </div>
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
        <option value="">자산 미지정</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} {asset.name}
          </option>
        ))}
      </select>
      <Input value={notes} onChange={setNotes} placeholder="메모" />
    </SmallForm>
  );
}

export function WatchlistForm({
  assets,
  onSubmit,
  pending,
}: {
  assets: InvestmentAsset[];
  onSubmit: (body: CreateInvestmentWatchlistInput) => void;
  pending: boolean;
}) {
  const [assetId, setAssetId] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  return (
    <SmallForm
      title="관심 자산 추가"
      pending={pending}
      disabled={!assetId}
      onSubmit={() => {
        onSubmit({
          assetId,
          targetPriceAmount: targetPrice ? parseInteger(targetPrice) : undefined,
          currency: selectedAsset?.currency,
        });
        setTargetPrice("");
      }}
    >
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
      <Input value={targetPrice} onChange={setTargetPrice} placeholder="목표 가격" />
    </SmallForm>
  );
}
