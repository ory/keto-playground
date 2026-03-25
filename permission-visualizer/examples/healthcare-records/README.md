# Healthcare Records

Patient Record Access with Care Teams and Consent. Patients own their medical records. Providers can access records if they are on the patient's care team or have been granted explicit consent. Emergency access is a separate break-the-glass mechanism.

## Permission Model

```
User ──care_team_doctors/care_team_nurses──▶ Patient ◄──patient── MedicalRecord
User ──consented_viewers──▶ Patient                       │
User ──emergency_access──▶ MedicalRecord                  │
```

### Permission Logic

- `MedicalRecord.view`: emergency_access on the record, OR patient's consented viewer, OR doctor/nurse on the patient's care team
- `MedicalRecord.edit`: doctor on the patient's care team only (nurses, consented viewers, and emergency access cannot edit)

### Providers (10)

- **Doctors**: dr-smith, dr-jones, dr-garcia, dr-kim
- **Nurses**: nurse-chen, nurse-patel, nurse-wilson, nurse-davis
- **Specialists/External**: dr-specialist-lee (consented viewer), therapist-brown (consented viewer)

### Patients & Care Teams

| Patient   | Doctors              | Nurses                    | Consented Viewers                  |
|-----------|----------------------|---------------------------|------------------------------------|
| patient-1 | dr-smith, dr-jones   | nurse-chen                | dr-specialist-lee                  |
| patient-2 | dr-jones             | nurse-chen, nurse-patel   | —                                  |
| patient-3 | dr-garcia, dr-kim    | nurse-wilson              | dr-specialist-lee, therapist-brown |
| patient-4 | dr-kim               | nurse-davis               | —                                  |
| patient-5 | dr-garcia            | nurse-wilson, nurse-patel | —                                  |

### Medical Records (11)

| Record    | Patient   | Emergency Access |
|-----------|-----------|------------------|
| record-1a | patient-1 | dr-garcia        |
| record-1b | patient-1 | —                |
| record-1c | patient-1 | —                |
| record-2a | patient-2 | —                |
| record-2b | patient-2 | —                |
| record-3a | patient-3 | —                |
| record-3b | patient-3 | —                |
| record-4a | patient-4 | —                |
| record-4b | patient-4 | —                |
| record-5a | patient-5 | —                |
| record-5b | patient-5 | —                |

## Exhaustive Expected Permissions (220 checks — all verified)

Format: V=view, E=edit. Y=Allowed, N=Denied.

| Provider            | 1a     | 1b     | 1c     | 2a     | 2b     | 3a     | 3b     | 4a     | 4b     | 5a     | 5b     |
|---------------------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|
| dr-smith            | VY EY  | VY EY  | VY EY  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  |
| dr-jones            | VY EY  | VY EY  | VY EY  | VY EY  | VY EY  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  |
| dr-garcia           | VY EN* | VN EN  | VN EN  | VN EN  | VN EN  | VY EY  | VY EY  | VN EN  | VN EN  | VY EY  | VY EY  |
| dr-kim              | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VY EY  | VY EY  | VY EY  | VY EY  | VN EN  | VN EN  |
| dr-specialist-lee   | VY EN  | VY EN  | VY EN  | VN EN  | VN EN  | VY EN  | VY EN  | VN EN  | VN EN  | VN EN  | VN EN  |
| therapist-brown     | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VY EN  | VY EN  | VN EN  | VN EN  | VN EN  | VN EN  |
| nurse-chen          | VY EN  | VY EN  | VY EN  | VY EN  | VY EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  |
| nurse-patel         | VN EN  | VN EN  | VN EN  | VY EN  | VY EN  | VN EN  | VN EN  | VN EN  | VN EN  | VY EN  | VY EN  |
| nurse-wilson        | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VY EN  | VY EN  | VN EN  | VN EN  | VY EN  | VY EN  |
| nurse-davis         | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VN EN  | VY EN  | VY EN  | VN EN  | VN EN  |

*dr-garcia has emergency_access on record-1a (view only), not on record-1b/1c.

## Test Commands

```bash
source .env

# Doctor on care team: view + edit
ory is allowed dr-smith view MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed dr-smith edit MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Nurse: view yes, edit no
ory is allowed nurse-chen view MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed nurse-chen edit MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Consented viewer: view yes, edit no
ory is allowed dr-specialist-lee view MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed dr-specialist-lee view MedicalRecord record-2a --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied (no consent)

# Emergency access: view only on specific record
ory is allowed dr-garcia view MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed dr-garcia edit MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Unrelated provider: denied
ory is allowed nurse-davis view MedicalRecord record-1a --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
