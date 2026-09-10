/// <reference path="../../../ccloader/js/types/plugin.d.ts" />

const STORAGE_KEY = "crosscode-item-tracker.lists";

function readState() {
	try {
		const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
		const savedLists = Array.isArray(state.lists) ? state.lists : [];
		const uniqueLists = [];
		const seenListKeys = {};
		for (const list of savedLists) {
			const key = list.outputId || list.name;
			if (seenListKeys[key]) continue;
			seenListKeys[key] = true;
			uniqueLists.push({...list, completed: list.completed === true, completedAt: list.completedAt || null});
		}
		const activeListId = uniqueLists.some((list) => list.id === state.activeListId) ? state.activeListId : (uniqueLists[0] && uniqueLists[0].id) || null;
		const trackedListIds = (Array.isArray(state.trackedListIds) ? state.trackedListIds : []).filter((id) => uniqueLists.some((list) => list.id === id));
		return {
			lists: uniqueLists,
			activeListId: activeListId,
			trackedListIds: trackedListIds.length ? trackedListIds : (activeListId ? [activeListId] : []),
			visible: state.visible !== false
		};
	} catch (error) {
		console.warn("Item Tracker: could not read saved lists", error);
		return {lists: [], activeListId: null, trackedListIds: [], visible: true};
	}
}

function writeState(state) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function itemLabel(item) {
	if (!item) return "Unknown item";
	try {
		return ig.LangLabel.getText(item.name);
	} catch (error) {
		return item.name || item.id || "Unknown item";
	}
}

function itemIcon(item) {
	return item && item.icon ? "\\i[" + item.icon + "]" : "";
}

function getItemSourceText(item) {
	const sources = (item && item.sources) || [];
	const groups = {};
	const locations = [];
	for (const source of sources) {
		if (!source || !source.value || source.type === "OTHER") continue;
		const label = source.type === "PLANT" ? "Botânica" : source.type === "ENEMY" ? "Criatura" : source.type;
		const sourceName = getSourceName(source);
		if (!groups[label]) groups[label] = [];
		if (groups[label].indexOf(sourceName) < 0) groups[label].push(sourceName);
		const location = getSourceLocation(source);
		if (location && locations.indexOf(location) < 0) locations.push(location);
	}
	const lines = Object.keys(groups).map((label) => label + ": " + groups[label].join(", "));
	if (locations.length) lines.push("Encontrado em: " + locations.join(", "));
	return lines.join("\n");
}

function getSourceName(source) {
	try {
		if (source.type === "ENEMY") return sc.combat.getEnemyName(source.value);
		if (source.type === "PLANT") {
			const plant = ig.database.get("drops")[source.value];
			const area = plant && plant.area ? sc.map.getAreaName(plant.area) : null;
			const name = plant && plant.name ? ig.LangLabel.getText(plant.name) : source.value;
			return area ? name + " (" + area + ")" : name;
		}
	} catch (error) {
		return source.value;
	}
	return source.value;
}

function getSourceLocation(source) {
	try {
		let areaId = null;
		if (source.type === "ENEMY") {
			const enemy = ig.database.get("enemies")[source.value];
			areaId = enemy && enemy.area;
		} else if (source.type === "PLANT") {
			const plant = ig.database.get("drops")[source.value];
			areaId = plant && plant.area;
		}
		return areaId ? sc.map.getAreaName(areaId) : null;
	} catch (error) {
		return null;
	}
}

function getSourceImage(source) {
	if (!source) return null;
	if (source.type === "ENEMY") return {enemy: source.value};
	if (source.type === "PLANT") return {image: new ig.Image("media/entity/pets/pet-plant.png"), width: 32, height: 32};
	return null;
}

function getOfferItems(offer) {
	const items = {};
	for (const requirement of (offer && offer.require) || []) {
		if (!requirement || requirement.id == null) continue;
		items[requirement.id] = (items[requirement.id] || 0) + (requirement.amount || 1);
	}
	return Object.keys(items).map((id) => ({id, amount: items[id]}));
}

function getActiveList(state) {
	return state.lists.find((list) => list.id === state.activeListId) || null;
}

function isListComplete(list) {
	return list.items.every((trackedItem) => {
		return (sc.model.player.getItemAmountWithEquip(trackedItem.id) || 0) >= trackedItem.amount;
	});
}

function updateListStatus(state) {
	let changed = false;
	for (const list of state.lists) {
		if (!list.completed && isListComplete(list)) {
			list.completed = true;
			list.completedAt = Date.now();
			state.trackedListIds = state.trackedListIds.filter((id) => id !== list.id);
			changed = true;
		}
	}
	if (state.activeListId && !state.lists.some((list) => list.id === state.activeListId && !list.completed)) {
		const nextList = state.lists.find((list) => !list.completed);
		state.activeListId = nextList ? nextList.id : null;
		changed = true;
	}
	if (changed) writeState(state);
}

function getActiveLists(state) {
	return state.lists.filter((list) => !list.completed);
}

function deleteList(listId) {
	const state = readState();
	state.lists = state.lists.filter((list) => list.id !== listId);
	state.trackedListIds = state.trackedListIds.filter((id) => id !== listId);
	if (state.activeListId === listId) {
		const nextList = state.lists.find((list) => !list.completed);
		state.activeListId = nextList ? nextList.id : null;
	}
	writeState(state);
}

function createList(offer) {
	const state = readState();
	const requirements = getOfferItems(offer);
	if (!requirements.length) return null;

	const output = offer.get && offer.get[0] && sc.inventory.getItem(offer.get[0].id);
	const outputId = offer.get && offer.get[0] && offer.get[0].id;
	const existingList = state.lists.find((list) => list.outputId === outputId || (!list.outputId && list.name === itemLabel(output)));
	if (existingList) {
		existingList.items = requirements;
		existingList.completed = false;
		existingList.completedAt = null;
		state.activeListId = existingList.id;
		if (state.trackedListIds.indexOf(existingList.id) < 0) state.trackedListIds.push(existingList.id);
		state.visible = true;
		writeState(state);
		return existingList;
	}
	const list = {
		id: "list-" + Date.now(),
		outputId: outputId,
		name: itemLabel(output),
		items: requirements
	};
	state.lists.push(list);
	state.activeListId = list.id;
	state.trackedListIds = state.trackedListIds.filter((id) => id !== list.id);
	state.trackedListIds.push(list.id);
	state.visible = true;
	writeState(state);
	return list;
}

function setVisible(visible) {
	const state = readState();
	state.visible = visible;
	writeState(state);
}

function toggleVisible() {
	const state = readState();
	setVisible(!state.visible);
	return !state.visible;
}

function getHudText() {
	const state = readState();
	updateListStatus(state);
	const list = getActiveList(state);
	if (!state.visible || !list) return "";

	const lines = [];
	lines.push("TRACK: " + list.name);
	for (const trackedItem of list.items) {
		const item = sc.inventory.getItem(trackedItem.id);
		const current = sc.model.player.getItemAmountWithEquip(trackedItem.id) || 0;
		const complete = current >= trackedItem.amount;
		lines.push((complete ? "\\i[check]" : itemIcon(item)) + itemLabel(item) + " " + Math.min(current, trackedItem.amount) + "/" + trackedItem.amount);
	}
	return lines.join("\n");
}

function setActiveList(listId) {
	const state = readState();
	if (!state.lists.some((list) => list.id === listId && !list.completed)) return;
	state.activeListId = listId;
	if (state.trackedListIds.indexOf(listId) < 0) state.trackedListIds.push(listId);
	writeState(state);
	if (window.itemTrackerHud) window.itemTrackerHud._refresh();
}

function cycleHudList() {
	const state = readState();
	updateListStatus(state);
	const lists = getActiveLists(state);
	if (!lists.length) {
		state.visible = false;
	} else {
		const currentIndex = lists.findIndex((list) => list.id === state.activeListId);
		if (!state.visible) {
			state.activeListId = lists[0].id;
			state.visible = true;
		} else if (currentIndex < lists.length - 1) {
			state.activeListId = lists[currentIndex + 1].id;
		} else {
			state.visible = false;
		}
	}
	writeState(state);
	if (window.itemTrackerHud) window.itemTrackerHud._refresh();
}

let ItemTrackerHud;

function ensureItemTrackerHud() {
	if (!ItemTrackerHud || window.itemTrackerHud) return window.itemTrackerHud;
	window.itemTrackerHud = new ItemTrackerHud();
	ig.gui.addGuiElement(window.itemTrackerHud);
	return window.itemTrackerHud;
}

function updateVisibilityButton(button) {
	button.setText(readState().visible ? "Hide" : "Show");
}

function createItemTrackerHudClass() {
	return ig.GuiElementBase.extend({
		text: null,
		background: null,
		init: function() {
			this.parent();
			this.setSize(190, 130);
			this.setAlign(ig.GUI_ALIGN.X_RIGHT, ig.GUI_ALIGN.Y_TOP);
			this.setPos(-8, 28);
			this.background = new ig.ColorGui("#111820D9", 190, 130);
			this.addChildGui(this.background);
			this.text = new sc.TextGui("", {font: sc.fontsystem.tinyFont});
			this.text.setPos(8, 6);
			this.addChildGui(this.text);
			this._refresh();
		},
		update: function() {
			this.parent();
			this._refresh();
		},
		_refresh: function() {
			const text = getHudText();
			this.text.setText(text);
			this.background.hook.size.y = text ? Math.min(130, Math.max(24, 10 * (text.split("\n").length + 1))) : 0;
			this.hook.size.y = this.background.hook.size.y;
			this.hook.visible = Boolean(text);
		}
	});
}

function createTrackerDetails(list, onDelete, onTrack) {
	const details = new ig.GuiElementBase;
	details.hook.transitions = {
		DEFAULT: {state: {}, time: 0.2, timeFunction: KEY_SPLINES.LINEAR},
		HIDDEN: {state: {alpha: 0}, time: 0.2, timeFunction: KEY_SPLINES.LINEAR}
	};
	details.setSize(281, 240);
	details.title = new sc.TextGui(list.name, {font: sc.fontsystem.tinyFont});
	details.title.setAlign(ig.GUI_ALIGN.X_CENTER, ig.GUI_ALIGN.Y_TOP);
	details.title.setPos(0, 4);
	details.addChildGui(details.title);
	details.itemRows = [];
	details.rowHighlights = [];
	details.infoButtons = [];
	details.infoLabels = [];
	details.deleteButton = new sc.ButtonGui("DELETE", null, true, sc.BUTTON_TYPE.SMALL);
	details.deleteButton.setAlign(ig.GUI_ALIGN.X_LEFT, ig.GUI_ALIGN.Y_BOTTOM);
	details.deleteButton.setPos(13, -2);
	details.deleteButton.onButtonPress = onDelete;
	details.addChildGui(details.deleteButton);
	details.trackButton = new sc.ButtonGui("Track", null, true, sc.BUTTON_TYPE.SMALL);
	details.trackButton.setAlign(ig.GUI_ALIGN.X_LEFT, ig.GUI_ALIGN.Y_BOTTOM);
	details.trackButton.setPos(110, -2);
	details.trackButton.onButtonPress = onTrack;
	details.addChildGui(details.trackButton);
	details.registerButton = function() {
		sc.menu.buttonInteract.addGlobalButton(details.deleteButton, function() {
			return sc.control.menuConfirm();
		});
		sc.menu.buttonInteract.addGlobalButton(details.trackButton, function() {
			return sc.control.menuConfirm();
		});
	};
	details.unregisterButton = function() {
		sc.menu.buttonInteract.removeGlobalButton(details.deleteButton);
		sc.menu.buttonInteract.removeGlobalButton(details.trackButton);
	};
	details.setList = function(nextList) {
		details.clearInfoButtons();
		details.title.setText(nextList.name);
		let rowY = 28;
		nextList.items.forEach((trackedItem) => {
			const item = sc.inventory.getItem(trackedItem.id);
			const current = sc.model.player.getItemAmountWithEquip(trackedItem.id) || 0;
			const sourceText = current > 0 ? getItemSourceText(item) : "";
			const rowText = itemIcon(item) + itemLabel(item) + " " + Math.min(current, trackedItem.amount) + "/" + trackedItem.amount;
			const rowGui = new sc.TextGui(rowText, {font: sc.fontsystem.tinyFont, linePadding: 0, maxWidth: 240});
			rowGui.setPos(13, rowY);
			details.addChildGui(rowGui);
			details.itemRows.push(rowGui);
			const rowHeight = Math.max(rowGui.hook.size.y, 14);
			if (sourceText) {
				const rowHighlight = new ig.ColorGui("rgba(255,140,0,0.35)", 254, rowHeight);
				rowHighlight.setPos(13, rowY);
				rowHighlight.hook.transitions = {
					IDLE: {state: {alpha: 0}, time: 0.1, timeFunction: KEY_SPLINES.LINEAR},
					HOVER: {state: {alpha: 1}, time: 0.1, timeFunction: KEY_SPLINES.LINEAR}
				};
				rowHighlight.doStateTransition("IDLE", true);
				details.addChildGui(rowHighlight);
				details.rowHighlights.push(rowHighlight);

				const infoButton = new ig.FocusGui;
				infoButton.setSize(254, rowHeight);
				infoButton.keepMouseFocus = true;
				infoButton.setPos(13, rowY);
				infoButton.focusGained = function() {
					ig.FocusGui.prototype.focusGained.call(this);
					rowHighlight.doStateTransition("HOVER");
				};
				infoButton.focusLost = function() {
					ig.FocusGui.prototype.focusLost.call(this);
					rowHighlight.doStateTransition("IDLE");
				};
				infoButton.onButtonPress = function() {
					const message = new sc.CenterMsgBoxGui(sourceText, {
						maxWidth: 240,
						speed: ig.TextBlock.SPEED.IMMEDIATE
					}, "black", 0.9);
					message.hook.zIndex = 15000;
					message.hook.pauseGui = true;
					const source = (item.sources || []).find((entry) => entry.type === "ENEMY" || entry.type === "PLANT");
					const sourceImage = getSourceImage(source);
					if (sourceImage) {
						const textHeight = message.textGui.hook.size.y;
						if (sourceImage.enemy) {
							const enemyDisplay = new sc.EnemyDisplayBox;
							enemyDisplay.setEnemy(sourceImage.enemy, true);
							enemyDisplay.setAlign(ig.GUI_ALIGN.X_CENTER, ig.GUI_ALIGN.Y_TOP);
							enemyDisplay.setPos(0, textHeight + 4);
							message.textGui.addChildGui(enemyDisplay);
							message.textGui.setSize(message.textGui.hook.size.x, textHeight + 119);
						} else {
							const imageGui = new ig.ImageGui(sourceImage.image, 0, 0, sourceImage.width, sourceImage.height);
							imageGui.setAlign(ig.GUI_ALIGN.X_CENTER, ig.GUI_ALIGN.Y_TOP);
							imageGui.setPos(0, textHeight + 4);
							message.textGui.addChildGui(imageGui);
							message.textGui.setSize(message.textGui.hook.size.x, textHeight + sourceImage.height + 8);
						}
						message.msgBox.resize();
					}
					ig.gui.addGuiElement(message);
				};
				details.addChildGui(infoButton);
				const infoLabel = new sc.TextGui("i", {font: sc.fontsystem.tinyFont});
				infoLabel.setPos(256, rowY);
				details.addChildGui(infoLabel);
				sc.menu.buttonInteract.addGlobalButton(infoButton, function() {
					return sc.control.menuConfirm();
				});
				details.infoButtons.push(infoButton);
				details.infoLabels.push(infoLabel);
			}
			rowY += rowHeight;
		});
	};
	details.clearInfoButtons = function() {
		for (const button of details.infoButtons) {
			sc.menu.buttonInteract.removeGlobalButton(button);
			details.removeChildGui(button);
		}
		details.infoButtons = [];
		for (const label of details.infoLabels) details.removeChildGui(label);
		details.infoLabels = [];
		for (const row of details.itemRows) details.removeChildGui(row);
		details.itemRows = [];
		for (const highlight of details.rowHighlights) details.removeChildGui(highlight);
		details.rowHighlights = [];
	};
	details.setList(list);
	details.doStateTransition("DEFAULT", true);
	return details;
}

export default class ItemTracker extends Plugin {
	main() {
		if (!ItemTrackerHud) ItemTrackerHud = createItemTrackerHudClass();
		ensureItemTrackerHud();
	}

	postload() {
		ig.module("item-tracker-trade-menu")
					.requires("game.feature.trade.gui.trade-menu", "game.feature.menu.gui.quests.quest-menu", "game.feature.menu.gui.enemies.enemy-pages")
			.defines(() => {
				sc.QuestInfoBox.inject({
					init: function() {
						this.parent();
						this.itemTrackerDetails = null;
					},
					setItemTrackerList: function(list, onDelete) {
						if (!this.itemTrackerDetails) {
							this.itemTrackerDetails = createTrackerDetails(list, onDelete, function() {
								setActiveList(list.id);
								const state = readState();
								state.visible = true;
								writeState(state);
								ensureItemTrackerHud();
								window.itemTrackerHud._refresh();
							});
							this.addChildGui(this.itemTrackerDetails);
						} else {
							this.itemTrackerDetails.deleteButton.onButtonPress = onDelete;
							this.itemTrackerDetails.trackButton.onButtonPress = function() {
								setActiveList(list.id);
								const state = readState();
								state.visible = true;
								writeState(state);
								ensureItemTrackerHud();
								window.itemTrackerHud._refresh();
							};
							this.itemTrackerDetails.setList(list);
						}
						this.itemTrackerDetails.unregisterButton();
						this.itemTrackerDetails.registerButton();
						this.setQuest(null);
						this.itemTrackerDetails.doStateTransition("DEFAULT", true);
					},
					clearItemTrackerList: function() {
						if (this.itemTrackerDetails) {
							this.itemTrackerDetails.clearInfoButtons();
							this.itemTrackerDetails.unregisterButton();
							this.itemTrackerDetails.doStateTransition("HIDDEN", true);
						}
					}
				});

				sc.QuestMenu.inject({
					init: function() {
						this.parent();
						window.itemTrackerQuestMenu = this;
					}
				});

				sc.TradeMenu.inject({
			init: function(settings) {
				this.parent(settings);
				if (!ItemTrackerHud) ItemTrackerHud = createItemTrackerHudClass();
				this.trackButton = new sc.ButtonGui("Track", null, true, sc.BUTTON_TYPE.SMALL);
				this.trackButton.keepMouseFocus = true;
				this.trackButton.onButtonPress = function() {
					const list = createList(sc.trade.getCurrentOffer());
					if (list && this.itemTrackerHud) this.itemTrackerHud._refresh();
				}.bind(this);
				this.trackButton.setAlign(ig.GUI_ALIGN.X_RIGHT, ig.GUI_ALIGN.Y_TOP);
				this.trackButton.setPos(73 + this.toggleEquip.hook.size.x, 0);
				this.trackButton.setData({description: "Track current crafting materials"});
				this.trackButton.doStateTransition("HIDDEN", true);
				this.addChildGui(this.trackButton);
				this.visibilityButton = new sc.ButtonGui("Hide", null, true, sc.BUTTON_TYPE.SMALL);
				this.visibilityButton.keepMouseFocus = true;
				this.visibilityButton.onButtonPress = function() {
					toggleVisible();
					updateVisibilityButton(this.visibilityButton);
					if (this.itemTrackerHud) this.itemTrackerHud._refresh();
				}.bind(this);
				this.visibilityButton.setAlign(ig.GUI_ALIGN.X_RIGHT, ig.GUI_ALIGN.Y_TOP);
				this.visibilityButton.setPos(73 + this.toggleEquip.hook.size.x + this.trackButton.hook.size.x, 0);
				this.visibilityButton.setData({description: "Show or hide the tracked list"});
				this.visibilityButton.doStateTransition("HIDDEN", true);
				this.addChildGui(this.visibilityButton);
				ensureItemTrackerHud();
				this.itemTrackerHud = window.itemTrackerHud;
			},
			enterTrade: function() {
				this.parent();
				sc.trade.buttonInteract.addGlobalButton(this.trackButton, function() { return false; });
				sc.trade.buttonInteract.addGlobalButton(this.visibilityButton, function() { return false; });
				this.trackButton.doStateTransition("DEFAULT");
				this.visibilityButton.doStateTransition("DEFAULT");
				updateVisibilityButton(this.visibilityButton);
				if (this.itemTrackerHud) this.itemTrackerHud._refresh();
			},
			_exitMenu: function() {
				this.trackButton.doStateTransition("HIDDEN");
				this.visibilityButton.doStateTransition("HIDDEN");
				this.parent();
			}
				});

				sc.QuestListBox.inject({
					init: function() {
						this.parent();
						const tab = new sc.ItemTabbedBox.TabButton("Lists", "quest", 90);
						tab.textChild.setPos(6, 0);
						tab.setPos(0, 2);
						tab.setData({type: "item-tracker-lists"});
						this.addChildGui(tab);
						this.tabGroup.addFocusGui(tab, 3, 0);
						this.tabArray[3] = tab;
						this._rearrangeTabs();
					},
					_createCacheList: function(type, regainFocus, mouseFocus, forceRegain) {
						if (sc.menu.questCurrentTab !== 3) {
							if (window.itemTrackerQuestMenu) window.itemTrackerQuestMenu.questInfoBox.clearItemTrackerList();
							if (this.itemTrackerList) {
								this.itemTrackerList.deactivate();
								this.itemTrackerList.doStateTransition("HIDDEN", true);
							}
							return this.parent(type, regainFocus, mouseFocus, forceRegain);
						}
						if (this.list) {
							this.list.deactivate();
							this.list.doStateTransition("HIDDEN", true);
						}

						if (!this.itemTrackerList) {
							this.itemTrackerGroup = new sc.ButtonGroup;
							this.itemTrackerList = new sc.ButtonListBox(1, 0, 28);
							this.itemTrackerList.hook.transitions = {
								DEFAULT: {state: {}, time: 0.2, timeFunction: KEY_SPLINES.LINEAR},
								HIDDEN: {state: {alpha: 0}, time: 0.2, timeFunction: KEY_SPLINES.LINEAR}
							};
							this.itemTrackerList.setPos(0, 35);
							this.itemTrackerList.setSize(264, 223);
							this.itemTrackerList.setButtonGroup(this.itemTrackerGroup);
							this.itemTrackerGroup.addSelectionCallback(function(button) {
								if (!button.data || !button.data.list) return;
								window.itemTrackerQuestMenu.questInfoBox.setItemTrackerList(button.data.list, function() {
									deleteList(button.data.list.id);
									this._createCacheList("item-tracker-lists", false, false, false);
									window.itemTrackerQuestMenu.questInfoBox.clearItemTrackerList();
								}.bind(this));
							}.bind(this));
							this.itemTrackerGroup.addPressCallback(function(button) {
								if (button.data && button.data.list) setActiveList(button.data.list.id);
							}.bind(this));
							this.addChildGui(this.itemTrackerList);
					}

						this.itemTrackerList.clear();
						this.itemTrackerGroup.clear();
						const state = readState();
						updateListStatus(state);
						for (const list of getActiveLists(state)) {
							const prefix = list.id === state.activeListId ? "\\i[quest-fav]" : "\\i[quest]";
							const button = new sc.ItemBoxButton(prefix + list.name, 236, 25, 0);
							button.setData({list: list});
							this.itemTrackerList.addButton(button);
						}
						this.itemTrackerList.activate();
						this.itemTrackerList.doStateTransition("DEFAULT", true);
					}
				});
			});
			window.addEventListener("keydown", (event) => {
				if (event.key.toLowerCase() !== "l" || event.repeat) return;
				cycleHudList();
			});
	}
}