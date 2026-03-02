def test_get_settings_defaults(client):
    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert data["slideshow_interval"] == 10
    assert data["transition_type"] == "crossfade"
    assert "photo_order" not in data


def test_update_settings_full(client):
    response = client.put(
        "/api/settings",
        json={
            "slideshow_interval": 20,
            "transition_type": "slide",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["slideshow_interval"] == 20
    assert data["transition_type"] == "slide"


def test_update_settings_partial(client):
    # First set to known state
    client.put("/api/settings", json={"slideshow_interval": 10, "transition_type": "crossfade"})

    # Partial update — only interval
    response = client.put("/api/settings", json={"slideshow_interval": 30})
    assert response.status_code == 200
    data = response.json()
    assert data["slideshow_interval"] == 30
    assert data["transition_type"] == "crossfade"  # unchanged


def test_settings_persist(client):
    client.put("/api/settings", json={"slideshow_interval": 42})

    response = client.get("/api/settings")
    assert response.json()["slideshow_interval"] == 42


def test_unknown_field_photo_order_ignored(client):
    """PUT with unknown field photo_order is ignored (backwards compatibility)."""
    response = client.put(
        "/api/settings",
        json={"photo_order": "random"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "photo_order" not in data
