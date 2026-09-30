from plans import render_settings_for_plan


def test_free_plan_gets_watermark_and_720p():
    settings = render_settings_for_plan("free")
    assert settings["watermark"] is True
    assert settings["max_height"] == 720


def test_pro_plan_has_no_watermark_and_1080p():
    settings = render_settings_for_plan("pro")
    assert settings["watermark"] is False
    assert settings["max_height"] == 1080


def test_unknown_plan_defaults_to_free_settings():
    assert render_settings_for_plan("nonsense") == render_settings_for_plan("free")
