const STAT_KEYS = Object.freeze(['health', 'energy', 'wealth', 'growth']);
const EQUIPMENT_TYPES = Object.freeze(['weapon', 'armor', 'pet']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertSafeInteger(value, name, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${name} must be a safe integer >= ${min}`);
  }
}

export const PHASE5_DEFINITION_VERSIONS = deepFreeze({
  items: 'items-v1',
  economy: 'economy-v1'
});

export const PHASE5_ITEM_DEFINITIONS = deepFreeze({
  potion_red: {
    itemKey: 'potion_red', title: '生命藥水', itemType: 'potion', rarity: 'common',
    currency: 'gold', basePrice: 25, catalogVersion: 1, stackable: true, maxStack: 99,
    usable: true, slot: null, effectKey: 'restore_hp_15', healAmount: 15
  },
  weapon_sword: {
    itemKey: 'weapon_sword', title: '木劍', itemType: 'weapon', rarity: 'common',
    currency: 'gold', basePrice: 60, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: 'weapon', effectKey: 'equipment_energy_2',
    equipmentModifiers: { energy: 2 }
  },
  armor_shield: {
    itemKey: 'armor_shield', title: '鐵盾', itemType: 'armor', rarity: 'common',
    currency: 'gold', basePrice: 80, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: 'armor', effectKey: 'equipment_health_3',
    equipmentModifiers: { health: 3 }
  },
  pet_cactus: {
    itemKey: 'pet_cactus', title: '仙人掌寵物', itemType: 'pet', rarity: 'uncommon',
    currency: 'gold', basePrice: 90, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: 'pet', effectKey: 'equipment_wealth_2_settlement_gold_1',
    equipmentModifiers: { wealth: 2 }, memberEffects: { settlementGoldBonus: 1 }
  },
  pet_dragon: {
    itemKey: 'pet_dragon', title: '小青龍寵物', itemType: 'pet', rarity: 'rare',
    currency: 'gold', basePrice: 130, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: 'pet', effectKey: 'equipment_health_2_growth_2',
    equipmentModifiers: { health: 2, growth: 2 }
  },
  rest_30: {
    itemKey: 'rest_30', title: '短暫休憩券', itemType: 'reward_ticket', rarity: 'common',
    currency: 'gems', basePrice: 3, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: null, effectKey: 'self_reward_rest_30'
  },
  favorite_drink: {
    itemKey: 'favorite_drink', title: '喜愛飲品券', itemType: 'reward_ticket', rarity: 'common',
    currency: 'gems', basePrice: 5, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: null, effectKey: 'self_reward_favorite_drink'
  },
  free_evening: {
    itemKey: 'free_evening', title: '自由晚間券', itemType: 'reward_ticket', rarity: 'uncommon',
    currency: 'gems', basePrice: 7, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: null, effectKey: 'self_reward_free_evening'
  },
  weekend_reward: {
    itemKey: 'weekend_reward', title: '週末犒賞券', itemType: 'reward_ticket', rarity: 'rare',
    currency: 'gems', basePrice: 12, catalogVersion: 1, stackable: false, maxStack: 1,
    usable: false, slot: null, effectKey: 'self_reward_weekend'
  }
});

export function calculateWealthDiscountPrice({ basePrice, baseWealth }) {
  assertSafeInteger(basePrice, 'basePrice');
  assertSafeInteger(baseWealth, 'baseWealth');
  const discountRate = Math.min(baseWealth * 0.01, 0.20);
  return {
    basePrice,
    baseWealth,
    discountRate,
    finalPrice: Math.floor(basePrice * (1 - discountRate))
  };
}

export function assertCatalogOffer({ item, seenCatalogVersion }) {
  if (!item || (seenCatalogVersion !== undefined && (
    !Number.isSafeInteger(seenCatalogVersion)
    || item.catalogVersion !== seenCatalogVersion
  ))) {
    return { ok: false, errorCode: 'CATALOG_CHANGED' };
  }
  return { ok: true };
}

export function applySettlementEquipmentGoldBonus(plan, settlementGoldBonus = 0) {
  assertSafeInteger(settlementGoldBonus, 'settlementGoldBonus');
  if (!plan || typeof plan !== 'object') throw new TypeError('plan must be an object');
  if (settlementGoldBonus === 0) {
    return {
      ...plan,
      equipmentEffects: { settlementGoldBonus: 0, itemsVersion: PHASE5_DEFINITION_VERSIONS.items }
    };
  }
  const resource = plan.resource || {};
  const after = resource.after || {};
  const deltas = resource.deltas || {};
  const rewardBreakdown = plan.rewardBreakdown || {};
  const daily = rewardBreakdown.daily || {};
  return {
    ...plan,
    resource: {
      ...resource,
      after: { ...after, gold: Number(after.gold || 0) + settlementGoldBonus },
      deltas: { ...deltas, gold: Number(deltas.gold || 0) + settlementGoldBonus }
    },
    rewardBreakdown: {
      ...rewardBreakdown,
      daily: { ...daily, gold: Number(daily.gold || 0) + settlementGoldBonus }
    },
    equipmentEffects: {
      settlementGoldBonus,
      itemsVersion: PHASE5_DEFINITION_VERSIONS.items
    }
  };
}

export function calculatePotionUse({ currentHp, maxHp, healAmount }) {
  assertSafeInteger(currentHp, 'currentHp');
  assertSafeInteger(maxHp, 'maxHp', { min: 1 });
  assertSafeInteger(healAmount, 'healAmount', { min: 1 });
  if (currentHp > maxHp) throw new RangeError('currentHp cannot exceed maxHp');
  if (currentHp === maxHp) return { ok: false, errorCode: 'HP_ALREADY_FULL' };
  const healed = Math.min(healAmount, maxHp - currentHp);
  return { ok: true, healed, hp: currentHp + healed };
}

export function deriveCharacterStats({
  baseStats,
  statusModifiers = [],
  equipmentModifiers = []
}) {
  const derived = {};
  STAT_KEYS.forEach(key => {
    const baseValue = Number(baseStats?.[key]);
    if (!Number.isFinite(baseValue)) throw new TypeError(`baseStats.${key} must be finite`);
    const modifiers = [...statusModifiers, ...equipmentModifiers]
      .reduce((total, modifier) => total + Number(modifier?.[key] || 0), 0);
    derived[key] = baseValue + modifiers;
  });
  return derived;
}

export function planInventoryMutation({ itemType, currentQuantity = 0, quantity = 1 }) {
  assertSafeInteger(currentQuantity, 'currentQuantity');
  assertSafeInteger(quantity, 'quantity', { min: 1 });
  if (itemType === 'potion') {
    const nextQuantity = currentQuantity + quantity;
    return nextQuantity <= 99
      ? { ok: true, nextQuantity }
      : { ok: false, errorCode: 'INVENTORY_STACK_LIMIT' };
  }
  if (EQUIPMENT_TYPES.includes(itemType)) {
    if (quantity !== 1) return { ok: false, errorCode: 'INVALID_QUANTITY' };
    return currentQuantity === 0
      ? { ok: true, nextQuantity: 1 }
      : { ok: false, errorCode: 'ITEM_ALREADY_OWNED' };
  }
  return { ok: false, errorCode: 'INVALID_ITEM_TYPE' };
}

export function planRewardInventoryMutation({ catalog, inventory = {}, rewards = [] }) {
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(rewards)) {
    return { ok: false, errorCode: 'INVALID_REWARD_PLAN' };
  }
  const working = { ...inventory };
  const inventoryChanges = [];
  for (const reward of rewards) {
    const itemKey = String(reward?.itemKey || '');
    const item = catalog[itemKey];
    if (!item) return { ok: false, errorCode: 'ITEM_NOT_FOUND' };
    const previousQuantity = Number(working[itemKey] || 0);
    let planned;
    try {
      planned = planInventoryMutation({
        itemType: item.itemType,
        currentQuantity: previousQuantity,
        quantity: reward.quantity
      });
    } catch (_error) {
      return { ok: false, errorCode: 'INVALID_REWARD_PLAN' };
    }
    if (!planned.ok) return planned;
    working[itemKey] = planned.nextQuantity;
    inventoryChanges.push({ itemKey, previousQuantity, nextQuantity: planned.nextQuantity });
  }
  return { ok: true, inventoryChanges };
}

export function createCatalogSnapshot(item) {
  if (!item || !PHASE5_ITEM_DEFINITIONS[item.itemKey]) throw new TypeError('unknown item definition');
  return deepFreeze({
    itemKey: item.itemKey,
    title: item.title,
    itemType: item.itemType,
    currency: item.currency,
    basePrice: item.basePrice,
    catalogVersion: item.catalogVersion,
    itemsVersion: PHASE5_DEFINITION_VERSIONS.items,
    economyVersion: PHASE5_DEFINITION_VERSIONS.economy,
    effectKey: item.effectKey
  });
}
