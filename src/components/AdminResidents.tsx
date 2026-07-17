import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useResidents } from '../lib/useResidents'

// residents.email is the primary key (schema.sql section 1) — it's the
// stable identity used throughout, so it's never itself editable inline.
// Changing someone's email is really "remove the old one, add the new
// one," not an edit.
export function AdminResidents() {
  const { residents, loading, error, refetch } = useResidents()

  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editingEmail, setEditingEmail] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRoom, setEditRoom] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function addResident(e: FormEvent) {
    e.preventDefault()
    setAdding(true)
    setAddError(null)

    const { error: insertError } = await supabase.from('residents').insert({
      email: newEmail.trim().toLowerCase(),
      full_name: newName.trim(),
      room_no: newRoom.trim(),
    })

    setAdding(false)
    if (insertError) {
      setAddError(insertError.message)
    } else {
      setNewEmail('')
      setNewName('')
      setNewRoom('')
      refetch()
    }
  }

  function startEdit(r: { email: string; full_name: string; room_no: string }) {
    setEditingEmail(r.email)
    setEditName(r.full_name)
    setEditRoom(r.room_no)
    setEditError(null)
  }

  async function saveEdit(email: string) {
    setSavingEdit(true)
    setEditError(null)

    // Keep an already-signed-up account in sync too — residents and
    // profiles are only linked by matching email at signup time
    // (handle_new_user), so without this a room change here wouldn't
    // reach anyone who already has an account.
    const [residentsRes, profilesRes] = await Promise.all([
      supabase
        .from('residents')
        .update({ full_name: editName.trim(), room_no: editRoom.trim() })
        .eq('email', email),
      supabase
        .from('profiles')
        .update({ full_name: editName.trim(), room_no: editRoom.trim() })
        .eq('email', email),
    ])

    setSavingEdit(false)
    if (residentsRes.error) {
      setEditError(residentsRes.error.message)
    } else if (profilesRes.error) {
      setEditError(profilesRes.error.message)
    } else {
      setEditingEmail(null)
      refetch()
    }
  }

  async function confirmDelete(email: string) {
    setDeleting(true)
    const { error: deleteError } = await supabase.from('residents').delete().eq('email', email)
    setDeleting(false)
    setPendingDelete(null)
    if (!deleteError) refetch()
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={addResident} className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">Email</label>
          <input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="resident@example.com"
            className="rounded-card border border-border bg-surface-elevated px-3 py-2 text-sm placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">Full name</label>
          <input
            type="text"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Jane Doe"
            className="rounded-card border border-border bg-surface-elevated px-3 py-2 text-sm placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">Room</label>
          <input
            type="text"
            required
            value={newRoom}
            onChange={(e) => setNewRoom(e.target.value)}
            placeholder="12"
            className="w-24 rounded-card border border-border bg-surface-elevated px-3 py-2 text-sm placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded-card bg-accent px-4 py-2 text-sm font-semibold text-text-primary transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          {adding ? 'Adding…' : 'Add resident'}
        </button>
        {addError && <p className="w-full text-sm text-danger">{addError}</p>}
      </form>

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-text-secondary">Loading residents…</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-text-secondary">
                <th className="px-4 py-3 font-medium">Room</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {residents.map((r) => {
                const isEditing = editingEmail === r.email
                const isPendingDelete = pendingDelete === r.email

                return (
                  <tr key={r.email} className="border-b border-border last:border-0">
                    {isEditing ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editRoom}
                            onChange={(e) => setEditRoom(e.target.value)}
                            className="w-20 rounded-card border border-border bg-surface-elevated px-2 py-1 text-sm focus:border-accent focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-card border border-border bg-surface-elevated px-2 py-1 text-sm focus:border-accent focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-2 text-text-secondary">{r.email}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={() => saveEdit(r.email)}
                              className="rounded-card bg-accent px-3 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-60"
                            >
                              {savingEdit ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={() => setEditingEmail(null)}
                              className="rounded-card border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                          {editError && <p className="mt-1 text-xs text-danger">{editError}</p>}
                        </td>
                      </>
                    ) : isPendingDelete ? (
                      <td colSpan={4} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-text-primary">
                            Remove {r.full_name} (Room {r.room_no}) from the resident list?
                          </p>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => confirmDelete(r.email)}
                              className="rounded-card bg-danger px-3 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-60"
                            >
                              {deleting ? 'Removing…' : 'Remove'}
                            </button>
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => setPendingDelete(null)}
                              className="rounded-card border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-text-primary">{r.room_no}</td>
                        <td className="px-4 py-2.5 text-text-primary">{r.full_name}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{r.email}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(r)}
                              className="rounded-card border border-border px-3 py-1.5 text-xs text-text-primary transition-transform active:scale-[0.96]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(r.email)}
                              className="rounded-card border border-danger/40 px-3 py-1.5 text-xs text-danger transition-transform active:scale-[0.96]"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {residents.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-secondary">
                    No residents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
