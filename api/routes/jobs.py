from fastapi import APIRouter, Depends, HTTPException

from api.jobs import JobInfo, JobStore, get_job_store

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobInfo)
def get_job(job_id: str, store: JobStore = Depends(get_job_store)) -> JobInfo:
    info = store.status(job_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Unknown job")
    return info
