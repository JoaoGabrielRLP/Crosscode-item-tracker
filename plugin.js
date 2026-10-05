/// <reference path="../../../ccloader/js/types/plugin.d.ts" />

const STORAGE_KEY = "crosscode-item-tracker.lists";

function getListKey(list) {
	const items = Array.isArray(list.baseItems) ? list.baseItems : (Array.isArray(list.items) ? list.items : []);
	const signature = items
		.map((item) => item.id + ":" + item.amount)
		.sort()
		.join(",");
	return (list.outputId || list.name) + "|" + signature;
}

function readState() {
	try {
		const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
		const savedLists = Array.isArray(state.lists) ? state.lists : [];
		const uniqueLists = [];
		const seenListKeys = {};
		for (const list of savedLists) {
			const key = getListKey(list);
			if (seenListKeys[key]) continue;
			seenListKeys[key] = true;
			uniqueLists.push({
				...list,
				baseItems: Array.isArray(list.baseItems) ? list.baseItems : list.items,
				completed: list.completed === true,
				completedAt: list.completedAt || null
			});
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

function localizedText(label) {
	if (typeof label === "string") return label;
	if (!label) return "";
	if (typeof label.value === "string" && label.value !== "MISSING LABEL") return label.value;
	if (label.data) return ig.LangLabel.getText(label.data);
	return ig.LangLabel.getText(label);
}

function getReadableMapName(mapPath) {
	const name = (mapPath || "").split(".").pop().split("/").pop();
	return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getItemSourceText(item) {
	const sources = (item && item.sources) || [];
	const groups = {};
	const locations = [];
	for (const source of sources) {
		if (!source || !source.value || source.type === "OTHER") continue;
		const label = source.type === "PLANT" ? "Botany" : source.type === "ENEMY" ? "Creature" : source.type;
		const sourceName = getSourceName(source);
		if (!groups[label]) groups[label] = [];
		if (groups[label].indexOf(sourceName) < 0) groups[label].push(sourceName);
		const location = getSourceLocation(source);
		if (location && locations.indexOf(location) < 0) locations.push(location);
	}
	const lines = Object.keys(groups).map((label) => label + ": " + groups[label].join(", "));
	if (locations.length) lines.push("Found in: " + locations.join(", "));
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
	if (source.type === "PLANT") return {plant: source.value};
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

const COMPLETION_DISPLAY_TIME = 3;
let completionHudQueue = [];
let completionHudListId = null;
let completionHudTime = 0;
let completionSound;
let currentTraderLocation = null;

function playCompletionSound() {
	if (!completionSound) completionSound = new ig.Sound("media/sound/hud/quest-solved.ogg", 0.6);
	completionSound.play();
}

function showNextCompletedHudList() {
	completionHudListId = completionHudQueue.shift() || null;
	completionHudTime = completionHudListId ? COMPLETION_DISPLAY_TIME : 0;
}

function queueCompletedHudList(list) {
	if (completionHudListId === list.id || completionHudQueue.indexOf(list.id) >= 0) return;
	completionHudQueue.push(list.id);
	if (!completionHudListId) showNextCompletedHudList();
}

function resetListForTracking(list) {
	const recipeItems = list.baseItems || list.items;
	list.items = recipeItems.map((item) => ({
		id: item.id,
		amount: (sc.model.player.getItemAmountWithEquip(item.id) || 0) + item.amount
	}));
	list.completed = false;
	list.completedAt = null;
	completionHudQueue = completionHudQueue.filter((id) => id !== list.id);
	if (completionHudListId === list.id) {
		completionHudListId = null;
		completionHudTime = 0;
	}
}

function haveSameRequirements(firstRequirements, secondRequirements) {
	if (!Array.isArray(firstRequirements) || firstRequirements.length !== secondRequirements.length) return false;
	const firstById = {};
	for (const requirement of firstRequirements) firstById[requirement.id] = requirement.amount;
	return secondRequirements.every((requirement) => firstById[requirement.id] === requirement.amount);
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
			queueCompletedHudList(list);
			playCompletionSound();
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

function areRequirementsEqual(a, b) {
	if (a.length !== b.length) return false;
	const sortById = (list) => [...list].sort((x, y) => (x.id > y.id ? 1 : x.id < y.id ? -1 : 0));
	const sortedA = sortById(a);
	const sortedB = sortById(b);
	return sortedA.every((item, index) => item.id === sortedB[index].id && item.amount === sortedB[index].amount);
}

function createList(offer) {
	const state = readState();
	const requirements = getOfferItems(offer);
	if (!requirements.length) return null;

	const output = offer.get && offer.get[0] && sc.inventory.getItem(offer.get[0].id);
	const outputId = offer.get && offer.get[0] && offer.get[0].id;
	const existingList = state.lists.find((list) => {
		const sameOutput = list.outputId === outputId || (!list.outputId && list.name === itemLabel(output));
		return sameOutput && areRequirementsEqual(list.baseItems || list.items, requirements);
	});
	if (existingList) {
		if (existingList.completed) resetListForTracking(existingList);
		existingList.baseItems = requirements.map((item) => ({...item}));
		if (currentTraderLocation) existingList.traderLocation = {...currentTraderLocation};
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
		items: requirements.map((item) => ({...item})),
		baseItems: requirements.map((item) => ({...item})),
		traderLocation: currentTraderLocation ? {...currentTraderLocation} : null
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
	const list = state.lists.find((entry) => entry.id === completionHudListId) || getActiveList(state);
	if ((!state.visible && !completionHudListId) || !list) return "";

	const lines = [];
	lines.push("TRACK: " + list.name);
	for (const trackedItem of list.items) {
		const item = sc.inventory.getItem(trackedItem.id);
		const current = sc.model.player.getItemAmountWithEquip(trackedItem.id) || 0;
		const complete = current >= trackedItem.amount;
		const line = (complete ? "\\i[check]" : itemIcon(item)) + itemLabel(item) + " " + Math.min(current, trackedItem.amount) + "/" + trackedItem.amount;
		lines.push(complete ? "\\c[3]" + line + "\\c[0]" : line);
	}
	if (list.completed) lines.push("\\c[3]completed\\c[0]");
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

function trackList(listId) {
	const state = readState();
	const list = state.lists.find((entry) => entry.id === listId);
	if (!list) return;
	if (list.completed) resetListForTracking(list);
	state.activeListId = listId;
	if (state.trackedListIds.indexOf(listId) < 0) state.trackedListIds.push(listId);
	state.visible = true;
	writeState(state);
	ensureItemTrackerHud();
	window.itemTrackerHud._refresh();
	const details = window.itemTrackerQuestMenu && window.itemTrackerQuestMenu.questInfoBox.itemTrackerDetails;
	if (details) details.setList(list);
}

function showTraderLocation(list) {
	const location = list.traderLocation;
	const map = location && location.map && location.map !== "MISSING LABEL"
		? localizedText(location.map)
		: location && location.mapPath ? getReadableMapName(location.mapPath) : "Visit trader and press Track to refresh";
	const locationText = location
		? "Trader: " + (localizedText(location.name) || "Unknown") + "\nRegion: " + (localizedText(location.area) || "Unknown") + "\nMap: " + (map || "Unknown")
		: "Trader location was not saved for this list.";
	const message = new sc.CenterMsgBoxGui(locationText, {
		maxWidth: 240,
		speed: ig.TextBlock.SPEED.IMMEDIATE
	}, "black", 0.9);
	message.hook.zIndex = 15000;
	message.hook.pauseGui = true;
	if (location && location.characterName) {
		const display = new sc.NPCDisplayGui(location.characterName, true);
		display.setAlign(ig.GUI_ALIGN.X_CENTER, ig.GUI_ALIGN.Y_TOP);
		display.setPos(0, message.textGui.hook.size.y + 4);
		message.textGui.addChildGui(display);
		message.textGui.setSize(message.textGui.hook.size.x, message.textGui.hook.size.y + 80);
	}
	ig.gui.addGuiElement(message);
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
			this.setSize(145, 130);
			this.setAlign(ig.GUI_ALIGN.X_RIGHT, ig.GUI_ALIGN.Y_TOP);
			this.setPos(-4, 18);
			this.background = new ig.ColorGui("#11182099", 145, 130);
			this.addChildGui(this.background);
			this.text = new sc.TextGui("", {font: sc.fontsystem.tinyFont, maxWidth: 133});
			this.text.setAlign(ig.GUI_ALIGN.X_LEFT, ig.GUI_ALIGN.Y_TOP);
			this.text.setPos(6, 6);
			this.addChildGui(this.text);
			this._refresh();
		},
		update: function() {
			this.parent();
			if (completionHudListId) {
				completionHudTime -= ig.system.tick;
				if (completionHudTime <= 0) {
					showNextCompletedHudList();
				}
			}
			this._refresh();
		},
		_refresh: function() {
			const text = getHudText();
			this.text.setText(text);
			this.background.hook.size.y = text ? Math.max(24, this.text.hook.size.y + 12) : 0;
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
	details.trackButton.setPos(13 + details.deleteButton.hook.size.x + 10, -2);
	details.trackButton.onButtonPress = onTrack;
	details.addChildGui(details.trackButton);
	details.locationButton = new sc.ButtonGui("Location", null, true, sc.BUTTON_TYPE.SMALL);
	details.locationButton.setAlign(ig.GUI_ALIGN.X_LEFT, ig.GUI_ALIGN.Y_BOTTOM);
	details.locationButton.setPos(13 + details.deleteButton.hook.size.x + details.trackButton.hook.size.x + 20, -2);
	details.locationButton.onButtonPress = function() {
		showTraderLocation(list);
	};
	details.addChildGui(details.locationButton);
	details.registerButton = function() {
		sc.menu.buttonInteract.addGlobalButton(details.deleteButton, function() {
			return sc.control.menuConfirm();
		});
		sc.menu.buttonInteract.addGlobalButton(details.trackButton, function() {
			return sc.control.menuConfirm();
		});
		sc.menu.buttonInteract.addGlobalButton(details.locationButton, function() {
			return sc.control.menuConfirm();
		});
	};
	details.unregisterButton = function() {
		sc.menu.buttonInteract.removeGlobalButton(details.deleteButton);
		sc.menu.buttonInteract.removeGlobalButton(details.trackButton);
		sc.menu.buttonInteract.removeGlobalButton(details.locationButton);
	};
	details.setList = function(nextList) {
		details.clearInfoButtons();
		details.title.setText(nextList.name);
		details.locationButton.onButtonPress = function() {
			showTraderLocation(nextList);
		};
		let rowY = 28;
		nextList.items.forEach((trackedItem) => {
			const item = sc.inventory.getItem(trackedItem.id);
			const current = sc.model.player.getItemAmountWithEquip(trackedItem.id) || 0;
			const sourceText = current > 0 ? getItemSourceText(item) : "";
			const row = itemIcon(item) + itemLabel(item) + " " + Math.min(current, trackedItem.amount) + "/" + trackedItem.amount;
			const rowText = current >= trackedItem.amount ? "\\c[3]" + row + "\\c[0]" : row;
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
						} else if (sourceImage.plant) {
							const plantDisplay = new sc.BotanicsPlantView;
							plantDisplay.setPlant(sourceImage.plant);
							plantDisplay.setAlign(ig.GUI_ALIGN.X_CENTER, ig.GUI_ALIGN.Y_TOP);
							plantDisplay.setPos(0, textHeight + 4);
							message.textGui.addChildGui(plantDisplay);
							message.textGui.setSize(message.textGui.hook.size.x, textHeight + plantDisplay.hook.size.y + 8);
						} else if (sourceImage.image) {
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
			.requires(
				"game.feature.trade.gui.trade-menu",
				"game.feature.menu.gui.quests.quest-menu",
				"game.feature.menu.gui.enemies.enemy-pages",
				"game.feature.menu.gui.botanics.botanics-misc",
				"game.feature.npc.gui.npc-display-gui"
			)
			.defines(() => {
				sc.BotanicsPlantView.inject({
					setPlant: function(plantKey, skipTransitions) {
						if (plantKey) {
							if (this.display) {
								this.display.remove(true);
								this.display = null;
							}
							const drop = ig.database.get("drops")[plantKey];
							const resolvedKey = (drop && drop.link) || plantKey;
							let anim = (sc.menu.dropCounts && sc.menu.dropCounts[resolvedKey] && sc.menu.dropCounts[resolvedKey].anim)
								|| (ig.globalSettings && ig.globalSettings.getGlobalSettingOptions("ENTITY", "ItemDestruct") && ig.globalSettings.getGlobalSettingOptions("ENTITY", "ItemDestruct")[resolvedKey] && ig.globalSettings.getGlobalSettingOptions("ENTITY", "ItemDestruct")[resolvedKey].desType)
								|| (sc.menu.dropCounts && sc.menu.dropCounts[plantKey] && sc.menu.dropCounts[plantKey].anim)
								|| (ig.globalSettings && ig.globalSettings.getGlobalSettingOptions("ENTITY", "ItemDestruct") && ig.globalSettings.getGlobalSettingOptions("ENTITY", "ItemDestruct")[plantKey] && ig.globalSettings.getGlobalSettingOptions("ENTITY", "ItemDestruct")[plantKey].desType)
								|| plantKey;
							if (!sc.ITEM_DESTRUCT_TYPE || !sc.ITEM_DESTRUCT_TYPE[anim]) {
								anim = "Autumn-Ground-1";
							}
							this.display = new sc.ItemDestructDisplayGui(resolvedKey, anim, true, this.centerEntity.bind(this));
							this.container.addChildGui(this.display);
							this.doStateTransition("DEFAULT", true);
						} else {
							this.parent(plantKey, skipTransitions);
						}
					}
				});

				sc.QuestInfoBox.inject({
					init: function() {
						this.parent();
						this.itemTrackerDetails = null;
					},
					setItemTrackerList: function(list, onDelete) {
						if (!this.itemTrackerDetails) {
							this.itemTrackerDetails = createTrackerDetails(list, onDelete, function() {
								trackList(list.id);
							});
							this.addChildGui(this.itemTrackerDetails);
						} else {
							this.itemTrackerDetails.deleteButton.onButtonPress = onDelete;
							this.itemTrackerDetails.trackButton.onButtonPress = function() {
								trackList(list.id);
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

				sc.TradeInfo.inject({
					startTradeMenu: function() {
						const mapName = sc.map.getCurrentMapName();
						currentTraderLocation = {
							traderId: this.key,
							name: localizedText(sc.trade.getTraderName(this.key)),
							area: localizedText(sc.trade.getTraderAreaName(this.key)),
							map: localizedText(mapName),
							mapPath: sc.map.currentMap || "",
							characterName: this.entity && this.entity.characterName || null
						};
						return this.parent();
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
						const lists = getActiveLists(state).concat(state.lists.filter((list) => list.completed));
						for (const list of lists) {
							const prefix = list.completed ? "\\i[quest-solve]" : list.id === state.activeListId ? "\\i[quest-fav]" : "\\i[quest]";
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