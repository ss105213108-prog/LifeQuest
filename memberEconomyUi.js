(function(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.LifeQuestMemberEconomyUi = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const STAT_KEYS = ['health', 'energy', 'wealth', 'growth'];

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function statBundle(value = {}) {
    return Object.fromEntries(STAT_KEYS.map(key => [key, number(value?.[key], 0)]));
  }

  function ticketStatus(ticket = {}) {
    if (ticket.reversedAt) return 'reversed';
    if (ticket.usedAt) return 'used';
    return ticket.status === 'reversed' || ticket.status === 'used' ? ticket.status : 'unused';
  }

  function transactionLabel(type = '') {
    const labels = {
      purchase_item: '購買補給',
      use_item: '使用補給',
      equip_item: '裝備物品',
      unequip_item: '卸下裝備',
      redeem_reward_ticket: '兌換犒賞券',
      use_reward_ticket: '使用犒賞券',
      reverse_reward_ticket: '取消犒賞券'
    };
    return labels[type] || '公會補給異動';
  }

  function createMemberEconomyViewModel(memberState = {}) {
    const player = memberState.player || {};
    const catalog = list(memberState.catalog);
    const inventory = list(memberState.inventory).filter(item => number(item.quantity, 0) > 0);
    const equipment = list(memberState.equipment);
    const tickets = list(memberState.rewardTickets).map(ticket => ({
      ...ticket,
      status: ticketStatus(ticket)
    }));
    const inventoryByKey = new Map(inventory.map(item => [item.itemKey, item]));
    const equipmentBySlot = Object.fromEntries(equipment.map(item => [item.slot, item]));
    const equipmentKeys = new Set(equipment.map(item => item.itemKey));
    const baseStats = statBundle(player.baseStats);
    const equipmentModifiers = statBundle(memberState.derivedEquipmentModifiers);
    const finalStats = statBundle(memberState.derivedStats || baseStats);
    const statusModifiers = Object.fromEntries(STAT_KEYS.map(key => [
      key,
      finalStats[key] - baseStats[key] - equipmentModifiers[key]
    ]));
    const baseWealth = Math.max(0, baseStats.wealth);
    const discountRate = Math.min(baseWealth * 0.01, 0.20);

    const catalogItems = catalog.map(item => {
      const owned = inventoryByKey.get(item.itemKey);
      const basePrice = Math.max(0, number(item.basePrice, 0));
      return {
        ...item,
        ownedQuantity: Math.max(0, number(owned?.quantity, 0)),
        owned: Math.max(0, number(owned?.quantity, 0)) > 0,
        equipped: equipmentKeys.has(item.itemKey),
        estimatedPrice: item.currency === 'gold'
          ? Math.floor(basePrice * (1 - discountRate))
          : basePrice
      };
    });

    const recentTransactions = list(memberState.recentEconomyTransactions)
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 10)
      .map(transaction => ({
        ...transaction,
        label: transactionLabel(transaction.type),
        itemLabel: transaction.itemName || transaction.itemKey || transaction.ticketName || '補給紀錄'
      }));

    return {
      source: 'member-cloud-authoritative',
      resources: {
        hp: Math.max(0, number(player.hp, 0)),
        maxHp: Math.max(1, number(player.maxHp, 1)),
        gold: Math.max(0, number(player.gold, 0)),
        gems: Math.max(0, number(player.gems, 0))
      },
      catalog: catalogItems,
      supplyCatalog: catalogItems.filter(item => item.itemType !== 'reward_ticket'),
      ticketCatalog: catalogItems.filter(item => item.itemType === 'reward_ticket'),
      inventory,
      inventoryByKey: Object.fromEntries(inventory.map(item => [item.itemKey, item])),
      equipment,
      equipmentBySlot,
      rewardTickets: tickets,
      recentTransactions,
      stats: { base: baseStats, equipment: equipmentModifiers, status: statusModifiers, final: finalStats },
      discountRate,
      repositoryVersion: Math.max(0, number(memberState.meta?.repositoryVersion, 0))
    };
  }

  return {
    STAT_KEYS,
    createMemberEconomyViewModel,
    ticketStatus,
    transactionLabel
  };
});
