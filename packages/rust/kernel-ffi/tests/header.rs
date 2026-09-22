use std::collections::BTreeSet;

const HEADER: &str = include_str!("../include/graphframework_kernel.h");
const SOURCE: &str = include_str!("../src/lib.rs");

const PUBLIC_SYMBOLS: &[&str] = &[
    "gv_abi_version",
    "gv_abort_edit",
    "gv_admit",
    "gv_analysis_facts",
    "gv_analysis_free",
    "gv_analysis_snapshot",
    "gv_analysis_snapshot_free",
    "gv_analyze",
    "gv_begin_edit",
    "gv_cancel",
    "gv_change_free",
    "gv_end_edit",
    "gv_evict",
    "gv_generation",
    "gv_inject_root",
    "gv_kernel_free",
    "gv_kernel_new",
    "gv_kernel_shutdown",
    "gv_pending_total",
    "gv_poll_next",
    "gv_replace",
    "gv_send",
    "gv_set_analysis_facts",
    "gv_settle_change",
    "gv_string_free",
    "gv_submission_state",
];

#[test]
fn public_header_covers_every_exported_c_symbol() {
    let source_symbols: BTreeSet<&str> = SOURCE
        .lines()
        .filter_map(|line| line.split("fn ").nth(1))
        .filter_map(|tail| tail.split('(').next())
        .filter(|name| name.starts_with("gv_"))
        .collect();
    let expected: BTreeSet<&str> = PUBLIC_SYMBOLS.iter().copied().collect();
    assert_eq!(source_symbols, expected);
    for symbol in PUBLIC_SYMBOLS {
        assert!(
            HEADER.contains(&format!("{symbol}(")),
            "public header is missing {symbol}"
        );
    }
}
