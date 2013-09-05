
const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const GIR = imports.gi.GIRepository;
const GWeather = imports.gi.GWeather;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

let settings, clocksSettings, openWinsCounter;

function init() {
}

const ListStoreColumns = {
  REFERENCE: 0,
  CODE: 1,
  DISPLAY: 2,
  VISIBLE: 3,
  INFEASIBLE: 4,
  LOCAL: 5,
  ORIG_DISPLAY: 6
};

let clocks_inhibitor;

const GladeSignalHandlers = new Lang.Class({
  Name: 'GladeSignalHandlers',
  
  _init: function (ui) {
    this.ui = ui;
  },

  'visible-change': function (object, row) {
    let ls = this.ui.get_object('location-list');
    let [valid, ic] = ls.get_iter_from_string(row);
    if (valid) {
      let hidden = [];
      ls.foreach(function (store, path, iter) {
	let visible = path.to_string() == row ? !object.active : store.get_value(iter, ListStoreColumns.VISIBLE);
	if (!visible) {
	  hidden.push(store.get_value(iter, ListStoreColumns.CODE));
	}
      });
      settings.set_value('hidden', new GLib.Variant('as', hidden));
    }
  },

  'display-edited': function (object, row, new_text) {
    let ls = this.ui.get_object('location-list');
    let [valid, ic] = ls.get_iter_from_string(row);
    if (valid) {
      if (new_text == ls.get_value(ic, ListStoreColumns.DISPLAY)) { return; }
      
      let nameMap = settings.get_value('name-map').deep_unpack();
      let code = ls.get_value(ic, ListStoreColumns.CODE);
      let oname = ls.get_value(ic, ListStoreColumns.ORIG_DISPLAY);
      let [,sfx] = oname.match(/ \((\w+)\)$/);
      if (new_text.match(/^\s*$/)) {
	new_text = oname;
      }
      new_text = new_text.replace(new RegExp(" \\("+sfx+"\\)\\s*$"), "");
      nameMap[code] = new_text;
      new_text = new_text + (sfx ? " (" + sfx + ")" : "");
      ls.set_value(ic, ListStoreColumns.DISPLAY, new_text);
      if (oname != new_text || delete nameMap[code]) {
	let newNameMap = {};
	ls.foreach(function (store, path, iter) {
	  let display = path.to_string() == row ? new_text : store.get_value(iter, ListStoreColumns.DISPLAY);
	  let code = store.get_value(iter, ListStoreColumns.CODE);
	  if (display != store.get_value(iter, ListStoreColumns.ORIG_DISPLAY) && nameMap[code]) {
	    newNameMap[code] = nameMap[code];
	  }
	});
	settings.set_value('name-map', new GLib.Variant('a{ss}', newNameMap));
      }
    }
  },

  'list-remove': function (store, path) {
    if (clocks_inhibitor) { return; }
    let na = this.ui.get_object('num-adj');
    let isMax = na.get_upper() <= na.get_value();
    let sv = clocksSettings.get_value('world-clocks');
    let oldClocks = sv.deep_unpack();
    let clocks = [];

    store.foreach(function (store, path, iter) {
      let representation = store.get_value(iter, ListStoreColumns.REFERENCE);
      let remain = oldClocks.filter(function (cl) {
	return cl.location.get_normal_form().print(true) == representation;
      });
      if (remain.length) {
	clocks.push(remain[0]);
      }
    });
    
    let newUpper = clocks.length + 1;
    na.set_upper(newUpper);
    if (isMax) { na.set_value(newUpper); }

    clocksSettings.set_value('world-clocks', new GLib.Variant('aa{sv}' /* sv.get_type_string() */, clocks));
    if (this.keep_selection) {
      this.ui.get_object('ll-list').get_selection().select_iter(this.keep_selection);
      this.keep_selection = null;
    }
  },

  'list-changed': function (store, path, iter) {
    this.keep_selection = iter;
  },

  'll-list-select': function (selection) {
    let [has, store, iter] = selection.get_selected();
    if (has && iter) {
      this.ui.get_object('remove-loc').set_sensitive(true);
    }
    else {
      this.ui.get_object('remove-loc').set_sensitive(false);
    }
  },

  'ad-changed': function () {
    this.ui.get_object('ad-ok-button').set_sensitive(
      this.locationEntry.location != null);
  },

  'add-loc': function (object) {
    if (!this.addDialog) {
      this.addDialog = this.ui.get_object('add-dialog');
      let dummyEntry = this.ui.get_object('ad-entry');
      let entry_parent = dummyEntry.get_parent();
      let baseEntry = new Gtk.Entry();
      this.locationEntry = new GWeather.LocationEntry({ top: GWeather.Location.new_world(true) });
      let GtkEntryGI = GIR.Repository.get_default().find_by_name('Gtk', 'Entry');
      let numProps = GIR.object_info_get_n_properties(GtkEntryGI);
      for (let i = 0; i < numProps; i +=1 ) {
	let prop = GIR.object_info_get_property(GtkEntryGI,i).get_name();
	if (dummyEntry[prop] != baseEntry[prop]) {
	  this.locationEntry[prop] = dummyEntry[prop];
	}
      }
      this.locationEntry.connect('changed', Lang.bind(this, this['ad-changed']));
      this.locationEntry.connect('editing-done', Lang.bind(this, this['ad-changed']));
      dummyEntry.destroy();
      entry_parent.add(this.locationEntry);
    }
    this.ui.get_object('ad-ok-button').set_sensitive(false);
    this.locationEntry.set_text("");
    this.addDialog.show_all();
  },

  'ad-cancel': function (object) {
    this.addDialog.hide();
  },

  'ad-close': function (object) {
    this.addDialog.hide();
    return true;
  },
  
  'ad-added': function (object) {
    let loc = this.locationEntry.location;
    if (loc != null) {
      let lbt = new Convenience.LocationBasedTime(loc);
      let isNew = true;
      let ls = this.ui.get_object('location-list');
      ls.foreach(function (store, path, iter) {
	if (store.get_value(iter, ListStoreColumns.CODE) == lbt.code) {
	  isNew = false;
	}
      });
      if (isNew) {
	let isLocal = lbt.tzSameAsLocal();
	let ser = loc.serialize();
	let hidden = settings.get_value('hidden').deep_unpack();
	let turnedOff = !settings.get_boolean('in-calendar');
	let hideLocal = settings.get_boolean('hide-local');
	let nameMap = settings.get_value('name-map').deep_unpack();
	let display = lbt.displayName2;
	if (nameMap[lbt.code]) {
	  let [,sfx] = display.match(/ \((\w+)\)$/);
	  display = nameMap[lbt.code] + (sfx ? " (" + sfx + ")" : "");
	}
	let iter = ls.insert_with_valuesv(-1, [ListStoreColumns.REFERENCE,ListStoreColumns.CODE,ListStoreColumns.ORIG_DISPLAY,ListStoreColumns.DISPLAY,ListStoreColumns.VISIBLE,ListStoreColumns.LOCAL,ListStoreColumns.INFEASIBLE], [
	  ser.get_normal_form().print(true),
	  lbt.code,
	  lbt.displayName2,
	  display,
	  !hidden.filter(function (v) { return v == lbt.code; }).length,
	  isLocal,
	  turnedOff ? true : hideLocal ? isLocal : false
	]);
	let m = this.ui.get_object('ll-list');
	m.get_selection().select_iter(iter);
	m.scroll_to_cell(Gtk.TreePath.new_from_string(this.ui.get_object('location-list').get_string_from_iter(iter)), null, false, 0, 0);
	let clocks = clocksSettings.get_value('world-clocks').deep_unpack();
	clocks.push({ location: ser });
	clocksSettings.set_value('world-clocks', new GLib.Variant('aa{sv}' /* sv.get_type_string() */, clocks));

	let na = this.ui.get_object('num-adj');
	let isMax = na.get_upper() <= na.get_value();
    
	let newUpper = clocks.length + 1;
	na.set_upper(newUpper);
	if (isMax) { na.set_value(newUpper); }
      }
    }
    this.addDialog.hide();
  },

  'remove-loc-sel': function (object) {
    let [has, store, iter] = this.ui.get_object('ll-list').get_selection().get_selected();
    if (has && iter) {
      store.remove(iter);
    }
  },
  
  _connector: function(builder, object, signal, handler) {
    if (this[handler]) {
      object.connect(signal, Lang.bind(this, this[handler]));
    }
  }
});

let position_inhibitor = false;

function buildPrefsWidget() {
  let ui = new Gtk.Builder(), win = new Gtk.Table();
  ui.add_from_file(Me.dir.get_path() + "/prefs.ui");

  ui.get_object('content-table').reparent(win);

  if (!settings) {
    settings = Convenience.getSettings();
    clocksSettings = Convenience.getClocksSettings();    
    openWinsCounter = 0;
  }
  else {
    openWinsCounter = openWinsCounter + 1;
  }

  let customTheme = new Gtk.CssProvider();
  customTheme.load_from_file(Me.dir.get_child('stylesheet.css'));
  Gtk.StyleContext.add_provider_for_screen(win.get_screen(), customTheme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  
  settings.bind('hide-local', ui.get_object('local-cb'), 'active', Gio.SettingsBindFlags.DEFAULT);
  settings.bind('in-calendar', ui.get_object('calendar-sw'), 'active', Gio.SettingsBindFlags.DEFAULT);
  settings.bind('num-buttons', ui.get_object('num-adj'), 'value', Gio.SettingsBindFlags.DEFAULT);

  ui.get_object('remove-loc').set_sensitive(false);
  
  let worldClocksUpdate = function () {
    if (clocks_inhibitor) { return; }
    clocks_inhibitor = true;
    let na = ui.get_object('num-adj');
    let isMax = na.get_upper() <= na.get_value();
    let clocks = clocksSettings.get_value('world-clocks').deep_unpack();
    let world = GWeather.Location.new_world(true);
    
    let newUpper = clocks.length + 1;
    na.set_upper(newUpper);
    if (isMax) { na.set_value(newUpper); }

    let ls = ui.get_object('location-list');
    ls.clear();
    let hidden = settings.get_value('hidden').deep_unpack();
    let nameMap = settings.get_value('name-map').deep_unpack();
    let turnedOff = !settings.get_boolean('in-calendar');
    let hideLocal = settings.get_boolean('hide-local');
    clocks.map(function (cl) {
      let lbt = new Convenience.LocationBasedTime(world.deserialize(cl.location));
      let isLocal = lbt.tzSameAsLocal();
      let display = lbt.displayName2;
      if (nameMap[lbt.code]) {
	let [,sfx] = display.match(/ \((\w+)\)$/);
	display = nameMap[lbt.code] + (sfx ? " (" + sfx + ")" : "");
      }
      
      ls.insert_with_valuesv(-1, [ListStoreColumns.REFERENCE,ListStoreColumns.CODE,ListStoreColumns.ORIG_DISPLAY,ListStoreColumns.DISPLAY,ListStoreColumns.VISIBLE,ListStoreColumns.LOCAL,ListStoreColumns.INFEASIBLE], [
	cl.location.get_normal_form().print(true),
	lbt.code,
	lbt.displayName2,
	display,
	!hidden.filter(function (v) { return v == lbt.code; }).length,
	isLocal,
	turnedOff ? true : hideLocal ? isLocal : false	
      ]);
    });
    clocks_inhibitor = false;
  };
  worldClocksUpdate();
  clocksSettings.connect('changed::world-clocks', worldClocksUpdate);

  let infeasibleState = function () {
    let ls = ui.get_object('location-list');
    let turnedOff = !settings.get_boolean('in-calendar');
    let hideLocal = settings.get_boolean('hide-local');
    ls.foreach(function (store, path, iter) {
      store.set_value(iter, ListStoreColumns.INFEASIBLE,
		      turnedOff ? true : hideLocal ? store.get_value(iter, ListStoreColumns.LOCAL) : false);
    });
  };
  settings.connect('changed::hide-local', infeasibleState);
  settings.connect('changed::in-calendar', infeasibleState);

  settings.connect('changed::hidden', function () {
    let ls = ui.get_object('location-list');
    let hidden = settings.get_value('hidden').deep_unpack();
    ls.foreach(function (store, path, iter) {
      let code = store.get_value(iter, ListStoreColumns.CODE);
      store.set_value(iter, ListStoreColumns.VISIBLE,
		      !hidden.filter(function (v) { return v == code; }).length);
    });
  });

  let positions_button_syms = ['LL', 'LR', 'ML', 'M1', 'MR', 'RL', 'RR'];
  positions_button_syms.map(function (pos_symbol) {
    let cl = pos_symbol;
    ui.get_object('position-' + cl).connect('toggled', function(object) {
      let cl2 = cl;
      if (position_inhibitor) { return; }
      position_inhibitor = true;
      positions_button_syms.map(function (j) {
  	let j2 = j;
  	ui.get_object('position-' + j2).set_active(j2 == cl2);
      });
      settings.set_string('button-position', cl2);
      position_inhibitor = false;
    });
  });
  let positionFromSetting = function() {
    ui.get_object('position-' + settings.get_string('button-position')).toggled();
  };
  positionFromSetting();
  settings.connect('changed::button-position', positionFromSetting);
  settings.connect('changed::name-map', worldClocksUpdate);
  
  let gladeSig = new GladeSignalHandlers(ui);
  ui.connect_signals_full(Lang.bind(gladeSig, gladeSig._connector));
  
  win.connect('destroy', function () {
    if (!openWinsCounter) {
      settings.run_dispose();
      settings = null;
      clocksSettings.run_dispose();
      clocksSettings = null;
    }
    else {
      openWinsCounter = openWinsCounter - 1;
    }
  });
  
  win.show_all();
  return win;
}
