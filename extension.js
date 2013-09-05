
const Lang = imports.lang;

const St = imports.gi.St;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const GnomeDesktop = imports.gi.GnomeDesktop;
const GWeather = imports.gi.GWeather;
const PanelMenu = imports.ui.panelMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const ExtensionSystem = imports.ui.extensionSystem;

const PopupMenu = imports.ui.popupMenu;
const Calendar = imports.ui.calendar;

const Gtk = imports.gi.Gtk;

const Gettext_dt = imports.gettext.domain('desktop_translations');
const _dt = Gettext_dt.gettext;

let clock, buttons = [], bics = [], gnomeClockSettings, mySettings, clocksSettings, extensionSig, locations, calendar_infos;

const WorldClockMultiButton = new Lang.Class({
  Name: 'WorldClockMultiButton',
  Extends: PanelMenu.Button,

  _init: function (lbt) {
    this.parent(0.25);

    this._myClockDisp = new St.Label({ opacity: 150 });
    this.actor.add_actor(this._myClockDisp);

    this._place = new St.Label({ style_class: 'location-label' });
    this._sunrise = new St.Label();
    this._sunset = new St.Label();

    let m = this.menu;
    m.addActor(this._place);

    let box = new St.BoxLayout({ style_class: 'location-day' });
    this._dayIcon = new St.Icon({
      icon_size: 15,
      icon_name: 'weather-clear-symbolic',
      opacity: 150,
      style_class: 'location-sunrise-icon'
    });
    box.add_actor(this._dayIcon);
    box.add_actor(this._sunrise);
    
    this._nightIcon = new St.Icon({
      icon_size: 15,
      icon_name: 'weather-clear-night-symbolic',
      style_class: 'location-sunset-icon'
    });
    box.add_actor(this._nightIcon);
    box.add_actor(this._sunset);
    m.addActor(box);

    // m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._selectLoc = new PopupMenu.PopupSubMenuMenuItem(_("Locations"));
    m.addMenuItem(this._selectLoc);

    this.setLbt(lbt);
  },

  setLbt: function (lbt) {
    this._lbt = lbt;
    this._gwInfo = GWeather.Info.new(lbt._loc, GWeather.ForecastType.ZONE);

    let nameMap = mySettings.get_value('name-map').deep_unpack();
    if (nameMap[lbt.code]) {
      this._place.set_text(nameMap[lbt.code]);
    }
    else {
      this._place.set_text(lbt.displayName);
    }
    this.make_loc_menu();
    this.refresh();
  },

  _fromUnix: function (time) {
    return GLib.DateTime.new_from_unix_utc(time).to_timezone(this._lbt._tz);
  },

  refresh: function () {
    this._myClockDisp.set_text(this._lbt.getTime());
    let i = this._gwInfo;
    i.update();

    let night_icon_key = 'weather-clear-night';
    let moonPhase_icon_name = castInt(i.get_value_moonphase()[1]/10) + "0";
    while (moonPhase_icon_name.length < 3) { moonPhase_icon_name = "0" + moonPhase_icon_name; }
    moonPhase_icon_name = night_icon_key + "-" + moonPhase_icon_name;

    if (!Gtk.IconTheme.get_default().has_icon(moonPhase_icon_name)) {
      moonPhase_icon_name = night_icon_key + '-symbolic';
    }
      
    let sunrise = i.get_value_sunrise();
    let sunriseTime = this._fromUnix(sunrise[1]);
    let sunset = i.get_value_sunset();
    let sunsetTime = this._fromUnix(sunset[1]);

    this._dayIcon.set_icon_name(!sunrise[0] && !i.is_daytime() ? moonPhase_icon_name : 'weather-clear-symbolic');
    this._nightIcon.set_icon_name(!sunset[0] && i.is_daytime() ? 'weather-clear-symbolic' : moonPhase_icon_name);

    this._dayIcon.set_opacity(!sunrise[0] && !i.is_daytime() ? 255 : 150);
    this._nightIcon.set_opacity(!sunset[0] && i.is_daytime() ? 150 : 255);

    this._sunrise.set_text(sunrise[0] ? sunriseTime.format(_(Convenience.get12hTimeFormat(sunriseTime))) : "\u2014\u2014");
    this._sunset.set_text(sunset[0] ? sunsetTime.format(_(Convenience.get12hTimeFormat(sunsetTime))) : "");
  },

  make_loc_menu: function () {
    let lm = this._selectLoc.menu;
    lm.removeAll();
    let that = this;
    let skipLocal = mySettings.get_boolean('hide-local');
    let nameMap = mySettings.get_value('name-map').deep_unpack();
    locations.map(function (loc) {
      let lbt = new Convenience.LocationBasedTime(loc);
      if (skipLocal && lbt.tzSameAsLocal()) { return; }
      let display = lbt.displayName2;
      if (nameMap[lbt.code]) {
	let [,sfx] = display.match(/ \((\w+)\)$/);
	display = nameMap[lbt.code] + (sfx ? " (" + sfx + ")" : "");
      }
      let item = new PopupMenu.PopupMenuItem(display);
      item.location = lbt;
      item.setShowDot(lbt.code == that._lbt.code);
      lm.addMenuItem(item);
      item.connect('activate', function (actor) {
	that.switchLbt(actor.location);
	saveButtonConfig();
      });
    });

    if (locations.length <= 1)
      this._selectLoc.actor.hide();
    else
      this._selectLoc.actor.show();
  },

  switchLbt: function (lbt) {
    let lastLoc = this._lbt;
    if (lastLoc.code == lbt.code) { return; }
    buttons.map(function (x) {
      if (x._lbt.code == lbt.code) {
	x.setLbt(lastLoc);
      }
    });
    this.setLbt(lbt);    
  }
});

function castInt(num) {
    return ~~num;
}

function saveButtonConfig() {
  let config = buttons.map(function (x) { return x._lbt.code; });
  mySettings.set_value('active-buttons', new GLib.Variant('as', config));
}

function init() {
  
}

let remaking;

function remakeButtons() {
  if (remaking) { return; }
  remaking = true;
  
  buttons.map(function (x) {
    x.destroy();
  });
  buttons = locations.map(function (loc) {
    let lbt = new Convenience.LocationBasedTime(loc);
    let btn = new WorldClockMultiButton(lbt);
    btn.refresh();
    return btn;
  });

  let i = 0;
  mySettings.get_value('active-buttons').deep_unpack().map(function (c) {
    let ob = buttons.filter(function (b) { return b._lbt.code == c; });
    if (ob[0] && buttons[i]) {
      buttons[i].switchLbt(ob[0]._lbt);
      i += 1;
    }
  });
  saveButtonConfig();

  let j = 1;
  let position = mySettings.get_string('button-position');
  let box_ref = ({
    'L': Main.panel._leftBox,
    'M': Main.panel._centerBox,
    'R': Main.panel._rightBox
  })[position[0]];
  let box_name = ({
    'L': 'left',
    'M': 'center',
    'R': 'right'
  })[position[0]];
  let start_position = ({
    'L': 0,
    '1': 1,
    'R': box_ref.get_n_children()
  })[position[1]];
  let numButtons = mySettings.get_value('num-buttons').deep_unpack();
  let skipLocal = mySettings.get_boolean('hide-local');
  buttons.map(function (x) {
    if (skipLocal && x._lbt.tzSameAsLocal()) { return; }
    if (j <= numButtons) {
      Main.panel.addToStatusArea('worldClock'+j, x, start_position + j - 1, box_name);
      j += 1;
    }
  });

  remaking = false;
}

function refreshLocations() {
  let world = GWeather.Location.new_world(true);
  
  let world_clocks = clocksSettings.get_value('world-clocks');
  locations = world_clocks.deep_unpack().map(function (e) {
    return world.deserialize(e.location);
  });
  // let location_infos = locations.map(function (e) {
  //   return GWeather.Info.new_for_world(world, e, GWeather.ForecastType.ZONE);
  // });

  remakeButtons();
  addClockCal();
}

function enable() {
  clock = new GnomeDesktop.WallClock();

  mySettings = Convenience.getSettings();
  clocksSettings =  Convenience.getClocksSettings();
  gnomeClockSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
  Convenience.gnomeClockSettings = gnomeClockSettings;
  Convenience.extensionSystem = ExtensionSystem;

  let dm = Main.panel.statusArea.dateMenu;

  let ev = dm._eventList;
  let ci = {};
  ci.eva = ev.actor;
  ci.evParent = ci.eva.get_parent();
  ci.box = new St.BoxLayout({ vertical: true });

  ci.content = new St.BoxLayout({ vertical: true });
  ci.box.add(ci.content);

  let separator = new PopupMenu.PopupSeparatorMenuItem();
  separator.setColumnWidths(1);
  ci.content.separator = separator.actor;
  ci.box.add(separator.actor, { y_align: St.Align.END, expand: false, y_fill: false });
  
  ci.eva.reparent(ci.box);
  
  ci.evParent.add(ci.box, { expand: true });
  ci.evParent.show();
  calendar_infos = ci;

  refreshLocations();

  let refreshAll = function () {
    buttons.map(function (x) {
      x.refresh();
    });
    refreshClockCal();
  };

  clock.connect('notify::clock', refreshAll);
  gnomeClockSettings.connect('changed::clock-format', refreshAll);
  let lunar = ExtensionUtils.extensions['lunarcal@ailin.nemui'];
  if (lunar && lunar.state == ExtensionSystem.ExtensionState.ENABLED && lunar.stateObj &&
	lunar.stateObj.settingsChanged && !lunar.stateObj.settingsChanged.world_clock_hook) {
    lunar.stateObj.settingsChanged.world_clock_hook = refreshAll;
  }
  extensionSig = ExtensionSystem.connect('extension-state-changed', function (signal, extn) {
    if (extn.uuid != 'lunarcal@ailin.nemui') { return; }
    if (extn.state == ExtensionSystem.ExtensionState.ENABLED && extn.stateObj &&
	!extn.stateObj.settingsChanged.world_clock_hook) {	
      extn.stateObj.settingsChanged.world_clock_hook = refreshAll;
    }
    refreshAll();
  });

  clocksSettings.connect('changed::world-clocks', refreshLocations);
  mySettings.connect('changed', function () {
    remakeButtons();
    addClockCal();
  });
}

function refreshClockCal() {
  bics.map(function (c) {
    let [dow, time, tz] = c.lbt.getTime(true);
    let timeString = time.replace(/:/g, "\u2236");
    let dayString = dow ? Calendar._getEventDayAbbreviation(dow % 7) : "";
    c.day.set_text(dayString);
    c.tz.set_text(tz);
    c.time.set_text(timeString);

    let parentBtn = buttons.filter(function (b) { return b._lbt.code == c.lbt.code; });
    if (parentBtn[0]) {
      let i = parentBtn[0]._gwInfo;
      i.update();

      if (i.is_daytime()) {
	c.icon.set_icon_name('weather-clear-symbolic');
	c.icon.set_opacity(150);
      }
      else {
	let night_icon_key = 'weather-clear-night';
	let moonPhase_icon_name = castInt(i.get_value_moonphase()[1]/10) + "0";
	while (moonPhase_icon_name.length < 3) { moonPhase_icon_name = "0" + moonPhase_icon_name; }
	moonPhase_icon_name = night_icon_key + "-" + moonPhase_icon_name;

	if (!Gtk.IconTheme.get_default().has_icon(moonPhase_icon_name)) {
	  moonPhase_icon_name = night_icon_key + '-symbolic';
	}
      
	c.icon.set_icon_name(moonPhase_icon_name);
	c.icon.set_opacity(255);
      }
    }
    else {
      c.icon.set_icon_name('');
      c.icon.set_opacity(0);
    }
  });
}

function addClockCal() {
  let vbox = calendar_infos.content;
  bics = [];
  vbox.destroy_all_children();
  if (!mySettings.get_boolean('in-calendar')) {
    vbox.hide();
    vbox.separator.hide();
    return;
  }
  else {
    vbox.show();
    vbox.separator.show();
  }
  
  vbox.add(new St.Label({ style_class: 'datemenu-date-label world-clock-label',
			  text: _dt("GenericName(kworldclock.desktop): World Clock").replace(/.*: /, "") }));

  // let box = new St.BoxLayout({ style_class: 'events-header-hbox' });
  // let dayNameBox = new St.BoxLayout({ vertical: true, style_class: 'events-day-name-box world-clock-day-box' });
  // let timeBox = new St.BoxLayout({ vertical: true, style_class: 'events-time-box world-clock-time-box' });
  // let tzBox = new St.BoxLayout({ vertical: true, style_class: 'events-time-box world-clock-tz-box' });
  // let nameBox = new St.BoxLayout({ vertical: true, style_class: 'events-event-box world-clock-name-box' });
  // box.add(dayNameBox, { x_fill: false });
  // box.add(timeBox, { x_fill: false });
  // box.add(tzBox, { x_fill: false });
  // box.add(nameBox, { expand: true });

  let box = new St.Table({ homogeneous: false, style_class: 'events-header-hbox' });
  box.add(new St.Label({ text: "\u2001", style_class: 'events-day-task' }), { row: 0, col: 6 });
  box.add(new St.Label({ text: "\u2001", style_class: 'events-day-task' }), { row: 0, col: 8 });

  vbox.add(box);

  let skipLocal = mySettings.get_boolean('hide-local');
  let nameMap = mySettings.get_value('name-map').deep_unpack();
  let hidden = mySettings.get_value('hidden').deep_unpack();
  let row = 0;
  locations.map(function (loc) {
    let lbt = new Convenience.LocationBasedTime(loc);
    if (skipLocal && lbt.tzSameAsLocal()) { return; }
    if (hidden.filter(function (v) { return v == lbt.code; }).length) { return; }
    let display = lbt.displayName2;
    if (nameMap[lbt.code]) {
      let [,sfx] = display.match(/ \((\w+)\)$/);
      display = nameMap[lbt.code] + (sfx ? " (" + sfx + ")" : "");
    }

    let object = {
      lbt: lbt,
      day: new St.Label({ style_class: 'events-day-name-box events-day-dayname' }),
      time: new St.Label({ style_class: 'events-time-box events-day-time' }),
      tz: new St.Label({ style_class: 'events-day-dayname' }),
      icon: new St.Icon({
	icon_size: 15,
	icon_name: 'weather-clear-symbolic',
	opacity: 150,
	style_class: 'location-sunrise-icon'
      })
    };
    box.add(object.day, { row: row, col: 1 });
    box.add(object.time, { row: row, col: 3 });
    box.add(object.tz, { row: row, col: 5 });
    box.add(new St.Label({ text: display, style_class: 'events-day-task' }), { row: row, col: 7 });
    box.add(object.icon, { row: row, col: 9 });
    bics[row] = object;
    row += 1;
    // Lang.bind(calendar_infos, Main.panel.statusArea.dateMenu._eventList._addEvent)(dayNameBox, timeBox, nameBox, true, dayString, timeString, display);
    // tzBox.add(new St.Label( { style_class: 'events-day-task', text: tz } ),
    //           { x_fill: true } );
  });
  refreshClockCal();
}


function disable() {
  ExtensionSystem.disconnect(extensionSig);
  extensionSig = null;
  locations = [];
  buttons.map(function (x) {
    x.destroy();
  });
  buttons = [];
  clock.run_dispose();
  clock = null;
  gnomeClockSettings.run_dispose();
  gnomeClockSettings = null;
  clocksSettings.run_dispose();
  clocksSettings = null;
  mySettings.run_dispose();
  mySettings = null;

  calendar_infos.eva.reparent(calendar_infos.evParent);
  calendar_infos.box.destroy();
}
