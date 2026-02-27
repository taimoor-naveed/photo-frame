def test_get_settings_defaults(client):
    response = client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert data["slideshow_interval"] == 10
    assert data["transition_type"] == "crossfade"
    assert data["photo_order"] == "random"


def test_update_settings_full(client):
    response = client.put(
        "/api/settings",
        json={
            "slideshow_interval": 20,
            "transition_type": "fade",
            "photo_order": "sequential",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["slideshow_interval"] == 20
    assert data["transition_type"] == "fade"
    assert data["photo_order"] == "sequential"


def test_update_settings_partial(client):
    # First set to known state
    client.put("/api/settings", json={"slideshow_interval": 10, "transition_type": "crossfade", "photo_order": "random"})

    # Partial update — only interval
    response = client.put("/api/settings", json={"slideshow_interval": 30})
    assert response.status_code == 200
    data = response.json()
    assert data["slideshow_interval"] == 30
    assert data["transition_type"] == "crossfade"  # unchanged
    assert data["photo_order"] == "random"  # unchanged


def test_settings_persist(client):
    client.put("/api/settings", json={"slideshow_interval": 42})

    response = client.get("/api/settings")
    assert response.json()["slideshow_interval"] == 42
