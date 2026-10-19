-- Aura Hub Pocket window rules for Omarchy's Lua Hyprland config.
--
-- Replace EXTENSION_ID with your extension's ID from brave://extensions (Developer mode on),
-- copy this file to ~/.config/hypr/aura-hub-pocket.lua and add
--   require("hypr.aura-hub-pocket")
-- to ~/.config/hypr/hyprland.lua, then run `hyprctl reload`.
--
-- The browser gives extension popup windows their own class
-- "<browser>-<extension id>-<profile>", so these rules never touch normal browser windows.
-- An unpacked extension's ID comes from its folder path: don't move the folder afterwards.

-- Service windows: float, stay visible on every workspace, open at the right edge.
-- The window size comes from the extension's per-service settings.
o.window("^.+-EXTENSION_ID-.+$", {
  float = true,
  pin = true,
  no_shortcuts_inhibit = true,
  move = { "(monitor_w-window_w-24)", "(monitor_h*0.06)" },
})

-- Launcher: with follow_mouse = 1, hovering another window would steal focus and close it.
-- no_follow_mouse keeps focus until you click elsewhere, so it closes like a menu.
o.window({ class = "^.+-EXTENSION_ID-.+$", title = "^Aura Hub Pocket Launcher$" }, {
  no_follow_mouse = true,
})
