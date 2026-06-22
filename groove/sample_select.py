import logging
from groove import db
from groove.audio_common import get_random_offset

logger = logging.getLogger(__name__)


def pick_next(conn, label_ids, filter_mode, untagged_only, pick_unique):
    """Select the next sample for the R key, always recording pick_order.

    When pick_unique is True: prefer unvisited samples; fall back to LRU restart
    when the filtered pool is fully visited.
    When pick_unique is False: pick fully at random from the filtered pool.
    In both modes pick_order is written so the pick window keeps growing.
    """
    if pick_unique:
        row = db.fetch_unvisited_sample(conn, label_ids, filter_mode, untagged_only)
        if not row:
            row = db.fetch_lru_sample(conn, label_ids, filter_mode, untagged_only)
    else:
        if untagged_only:
            row = db.fetch_random_untagged_sample(conn)
        else:
            row = db.fetch_random_sample(conn, label_ids or None, filter_mode)

    if not row:
        return None

    next_order = db.fetch_next_pick_order(conn)
    db.set_pick_order(conn, row['id'], next_order)

    index_num = db.fetch_sample_index(conn, row['id'])
    start_offset = get_random_offset(row['duration_samples'], row['samplerate'])

    result = dict(row)
    result['index_num'] = index_num
    result['start_offset'] = start_offset
    result['pick_order'] = next_order
    return result


def pick_adjacent(conn, sample_id, direction, label_ids, filter_mode, untagged_only):
    """Navigate one step in the pick window without modifying pick_order.

    direction: +1 forward (J), -1 backward (K).
    Returns a result dict, or None when at the boundary.
    """
    row = db.fetch_adjacent_in_window(conn, sample_id, direction, label_ids, filter_mode, untagged_only)
    if not row:
        return None
    return _to_result(conn, row)


def pick_window_edge(conn, edge, label_ids, filter_mode, untagged_only):
    """Jump to the oldest ('oldest') or newest ('newest') sample in the pick window.

    Returns a result dict, or None when the window is empty.
    """
    row = db.fetch_window_edge(conn, edge, label_ids, filter_mode, untagged_only)
    if not row:
        return None
    return _to_result(conn, row)


def _to_result(conn, row):
    index_num = db.fetch_sample_index(conn, row['id'])
    result = dict(row)
    result['index_num'] = index_num
    result['start_offset'] = 0
    return result
