
const Lang = imports.lang;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GWeather = imports.gi.GWeather;
const ExtensionUtils = imports.misc.extensionUtils;
//const ExtensionSystem = imports.ui.extensionSystem;

const Gettext_gd30 = imports.gettext.domain('gnome-desktop-3.0');
const _gd30 = Gettext_gd30.gettext;

let gnomeClockSettings, extensionSystem;

function getClocksSettings() {
  let schema_id = 'org.gnome.clocks';
  if (Gio.Settings.list_schemas().indexOf(schema_id) == -1) {
    let extension = ExtensionUtils.getCurrentExtension();
    return new Gio.Settings({
      settings_schema: Gio.SettingsSchemaSource.new_from_directory(
	extension.dir.get_child('schemas').get_path(),
	Gio.SettingsSchemaSource.get_default(),
	false)
	.lookup(schema_id, false)
    });
  }
  else {
    return new Gio.Settings({ schema: schema_id });
  }
}

function getSettings() {
  let extension = ExtensionUtils.getCurrentExtension();
  return new Gio.Settings({
    settings_schema: Gio.SettingsSchemaSource.new_from_directory(
      extension.dir.get_child('schemas').get_path(),
      Gio.SettingsSchemaSource.get_default(),
      false)
      .lookup(extension.metadata['settings-schema'], false)
  });
}

const LocationBasedTime = new Lang.Class({
  Name: 'LocationBasedTime',

  _init: function (loc) {
    this._loc = loc;
    this._tz = GLib.TimeZone.new(loc.get_timezone().get_tzid());

    this.displayName = loc.get_city_name();

    let country = loc;
    while (country.get_level() > GWeather.LocationLevel.CITY) {
      country = country.get_parent();
    }
    while (country.get_level() > GWeather.LocationLevel.COUNTRY) {
      this.displayName2 = (this.displayName2 ? this.displayName2 + ", " : "") + country.get_name();
      country = country.get_parent();
    }
    if (country) {
      this.displayName = (this.displayName ? this.displayName + ", " : "") + country.get_name();
    }
    this.displayName2 = (this.displayName2 ? this.displayName2 +
			 " (" + loc.get_country() + ")" : loc.get_country());

    let ncode = [loc];
    let code = [];
    while (!code.length && ncode.length) {
      ncode = ncode.map(function (x) {
	let c = x.get_code();
	if (c) {
	  code.push(c);
	  return [];
	}
	return x.get_children();
      }).reduce(function (a, b) {
	return a.concat(b);
      });
    }
    this.code = code.join(",");
  },

  now: function () {
    return GLib.DateTime.new_now(this._tz);
  },

  tzSameAsLocal: function () {
    let now = this.now();
    return now.get_timezone_abbreviation() == now.to_local().get_timezone_abbreviation();
  },

  getTime: function (split_view) {
    if (!split_view) { split_view = false; }
    let now = this.now();
    let now_here = now.to_local();
    let format_string = _gd30((!split_view && now_here.get_day_of_month() != now.get_day_of_month() ?
			   "%a " : "") + get12hTimeFormat(now));

    let lunar = ExtensionUtils.extensions['lunarcal@ailin.nemui'];
    if (lunar && lunar.state == extensionSystem.ExtensionState.ENABLED && lunar.stateObj &&
	lunar.stateObj.settings && lunar.stateObj.settings.get_boolean('show-time')) {
      let ld = lunar.stateObj.ld;
      ld.set_solar_date(now.get_year(), now.get_month(), now.get_day_of_month(), now.get_hour());

      if (split_view) {
	return [ now_here.get_day_of_month() != now.get_day_of_month() ? now.get_day_of_week() : 0, now.format(format_string), ld.strftime("%(SHI)") + now.format(" %Z") ];
      }
    
      return now.format(format_string) + ld.strftime("%(SHI)") + now.format(" %Z");
    }

    if (split_view) {
      return [ now_here.get_day_of_month() != now.get_day_of_month() ? now.get_day_of_week() : 0, now.format(format_string), now.format("%Z") ];
    }
    
    return now.format(format_string + " %Z");
  }
});

function unpack_all_v(o) {
  if (o instanceof GLib.Variant) {
    let sig = o.get_type_string();
    o = o.deep_unpack();
    o.__signature__ = sig;
  }
  if (o instanceof Object) {
    for (let p in o) {
      o[p] = unpack_all_v(o[p]);
    }
  }
  return o;
}

function get12hTimeFormat(when) {
  return gnomeClockSettings.get_string('clock-format') != '12h' ||
    !when.format("%p").length ? "%R" : "%l:%M %p";
}

function pack_all_v(o) {
  if (o instanceof Object) {
    for (let p in o) {
      o[p] = pack_all_v(o[p]);
    }
  }
  if (o.__signature__) {
    o = new GLib.Variant(o.__signature__, o);
  }
  return o;
}
